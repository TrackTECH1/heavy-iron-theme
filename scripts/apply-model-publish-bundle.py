#!/usr/bin/env python3
"""Apply shopify-api-manifest.json → Model metaobject fields via Admin API.

Updates track_products, uc_products, and primary_track_size on each Model metaobject.
Hero images: use Matrixify import from matrixify-model-publish.csv (file URL upload).

Requires: data/model-publish/shopify-api-manifest.json from export-model-publish-bundle.py

Usage:
  python3 scripts/apply-model-publish-bundle.py --dry-run
  python3 scripts/apply-model-publish-bundle.py --apply
  python3 scripts/apply-model-publish-bundle.py --apply --handle john-deere-323e --only-changed
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

MANIFEST = ROOT / "data" / "model-publish" / "shopify-api-manifest.json"
STORE = os.environ.get("SHOPIFY_STORE_DOMAIN", "tracktech-530.myshopify.com")
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-10")
SLEEP_SEC = 0.35

MO_BY_HANDLE = """
query ModelByHandle($handle: String!) {
  metaobjectByHandle(handle: { type: "model", handle: $handle }) {
    id
    handle
    trackProducts: field(key: "track_products") { value }
    trackVariants: field(key: "track_variants") { value }
    ucProducts: field(key: "uc_products") { value }
    primaryTrackSize: field(key: "primary_track_size") { value }
  }
}
"""

PRODUCT_VARIANTS = """
query ProductVariants($id: ID!) {
  product(id: $id) {
    variants(first: 100) { nodes { id sku } }
  }
}
"""

MO_UPDATE = """
mutation UpdateModelProducts($id: ID!, $fields: [MetaobjectFieldInput!]!) {
  metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
    metaobject { id handle }
    userErrors { field message }
  }
}
"""


def load_env() -> None:
    env_file = ROOT / ".env.fitment.local"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def shopify_gql_cli(query: str, variables: dict | None = None, *, mutation: bool = False) -> dict:
    cmd = [
        "shopify",
        "store",
        "execute",
        "--store",
        STORE,
        "--query",
        query,
        "--json",
    ]
    if mutation:
        cmd.append("--allow-mutations")
    if variables:
        cmd.extend(["--variables", json.dumps(variables)])
    env = {
        **dict(os.environ),
        "SHOPIFY_CLI_AGENT_INFO": "n:cursor|v:1|p:cursor",
        "SHOPIFY_CLI_AGENT_IDS": "s:apply-model-publish|r:script|i:1",
    }
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout)
    return json.loads(r.stdout)


def shopify_gql(query: str, variables: dict | None = None, *, mutation: bool = False) -> dict:
    token = os.environ.get("SHOPIFY_ADMIN_TOKEN")
    if token:
        url = f"https://{STORE}/admin/api/{API_VERSION}/graphql.json"
        body = json.dumps({"query": query, "variables": variables or {}}).encode()
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": token,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return shopify_gql_cli(query, variables, mutation=mutation)
            raise
        if payload.get("errors"):
            raise RuntimeError(json.dumps(payload["errors"]))
        return payload.get("data") or payload
    return shopify_gql_cli(query, variables, mutation=mutation)


def parse_gid_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [g for g in parsed if isinstance(g, str) and g.startswith("gid://")]


def product_gids_to_variant_gids(product_gids: list[str], cache: dict[str, list[str]]) -> list[str]:
    out: list[str] = []
    for pgid in product_gids:
        if pgid in cache:
            out.extend(cache[pgid])
            continue
        data = shopify_gql(PRODUCT_VARIANTS, {"id": pgid}, mutation=False)
        variants = ((data.get("product") or {}).get("variants") or {}).get("nodes") or []
        vgids = [v["id"] for v in variants if v.get("id")]
        cache[pgid] = vgids
        out.extend(vgids)
        time.sleep(SLEEP_SEC)
    return sorted(set(out))


def build_fields(entry: dict, variant_cache: dict[str, list[str]], *, use_track_variants: bool = True) -> list[dict]:
    fields: list[dict] = []
    pts = (entry.get("primary_track_size") or "").strip()
    if pts:
        fields.append({"key": "primary_track_size", "value": pts})
    track_products = entry.get("track_product_gids") or []
    uc = entry.get("uc_product_gids") or []
    if track_products:
        if use_track_variants:
            variants = product_gids_to_variant_gids(track_products, variant_cache)
            if variants:
                fields.append({"key": "track_variants", "value": json.dumps(variants)})
        else:
            fields.append({"key": "track_products", "value": json.dumps(sorted(track_products))})
    if uc:
        fields.append({"key": "uc_products", "value": json.dumps(sorted(uc))})
    return fields


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--handle", help="Single model Shopify handle")
    ap.add_argument("--only-changed", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    apply = args.apply and not args.dry_run

    if not MANIFEST.is_file():
        print(f"Missing {MANIFEST} — run export-model-publish-bundle.py first", file=sys.stderr)
        return 1

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    models = manifest.get("models") or []

    if args.handle:
        models = [m for m in models if m.get("handle") == args.handle.strip()]
        if not models:
            print(f"No manifest entry for handle: {args.handle}", file=sys.stderr)
            return 1

    variant_cache: dict[str, list[str]] = {}
    stats = {"planned": 0, "updated": 0, "unchanged": 0, "skipped": 0, "errors": 0}

    for entry in models:
        if entry.get("status") == "blocked":
            stats["skipped"] += 1
            continue
        if args.limit and stats["planned"] + stats["updated"] >= args.limit and not apply:
            break
        if args.limit and stats["updated"] >= args.limit and apply:
            break

        handle = entry.get("handle") or ""
        fields = build_fields(entry, variant_cache, use_track_variants=True)
        if not fields:
            stats["skipped"] += 1
            continue

        data = shopify_gql(MO_BY_HANDLE, {"handle": handle})
        mo = data.get("metaobjectByHandle")
        if not mo or not mo.get("id"):
            stats["skipped"] += 1
            print(f"SKIP  {handle}: no Model metaobject in {STORE}", file=sys.stderr)
            continue

        model_gid = mo["id"]
        if args.only_changed and apply:
            current_track = parse_gid_list((mo.get("trackVariants") or {}).get("value"))
            if not current_track:
                current_track = parse_gid_list((mo.get("trackProducts") or {}).get("value"))
            current_uc = parse_gid_list((mo.get("ucProducts") or {}).get("value"))
            current_pts = ((mo.get("primaryTrackSize") or {}).get("value") or "").strip()
            new_track = product_gids_to_variant_gids(entry.get("track_product_gids") or [], variant_cache)
            new_uc = sorted(entry.get("uc_product_gids") or [])
            new_pts = (entry.get("primary_track_size") or "").strip()
            if current_track == new_track and current_uc == new_uc and current_pts == new_pts:
                stats["unchanged"] += 1
                continue

        stats["planned"] += 1
        label = (
            f"{handle}: pts={entry.get('primary_track_size') or '—'} "
            f"variants={len(product_gids_to_variant_gids(entry.get('track_product_gids') or [], variant_cache))} "
            f"uc={len(entry.get('uc_product_gids') or [])}"
        )

        if not apply:
            print(f"PLAN  {label}", file=sys.stderr)
            continue

        try:
            result = shopify_gql(
                MO_UPDATE,
                {"id": model_gid, "fields": fields},
                mutation=True,
            )
            errs = (result.get("metaobjectUpdate") or {}).get("userErrors") or []
            if errs:
                raise RuntimeError("; ".join(f"{e.get('field')}: {e.get('message')}" for e in errs))
            stats["updated"] += 1
            print(f"OK    {label}", file=sys.stderr)
            time.sleep(SLEEP_SEC)
        except Exception as e:
            stats["errors"] += 1
            print(f"ERR   {handle}: {e}", file=sys.stderr)

    mode = "apply" if apply else "dry-run"
    print(
        f"\nDone ({mode}): planned={stats['planned']} updated={stats['updated']} "
        f"unchanged={stats['unchanged']} skipped={stats['skipped']} errors={stats['errors']}",
        file=sys.stderr,
    )
    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
