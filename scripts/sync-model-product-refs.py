#!/usr/bin/env python3
"""Sync Supabase fitment → Shopify Model metaobject product lists.

Model pages (main-fitment.liquid) and JSON-LD (hi-machine-jsonld.liquid) read
track_products / uc_products on each Model metaobject. Fitment SSOT lives in
Supabase; this script is the inverse of sync-product-fitments (product-centric).

Prerequisites:
  ./scripts/fitment doctor
  ./scripts/fitment sync   (backfill GIDs + product fitments first)

Usage:
  python3 scripts/sync-model-product-refs.py --dry-run
  python3 scripts/sync-model-product-refs.py --apply
  python3 scripts/sync-model-product-refs.py --apply --handle case-tv450b
  python3 scripts/sync-model-product-refs.py --apply --limit 50
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
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from lib.catalog_ssot import supabase_get_all, supabase_key  # noqa: E402

STORE = os.environ.get("SHOPIFY_STORE_DOMAIN", "tracktech-530.myshopify.com")
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-10")
SLEEP_SEC = 0.35

FITMENT_SELECT = (
    "fitment?select=fit_type,"
    "product:product_id(shopify_product_id,product_code,handle),"
    "model:model_id(model_key,model_handle,shopify_metaobject_gid)"
)

MO_BY_HANDLE = """
query ModelByHandle($handle: String!) {
  metaobjectByHandle(handle: { type: "model", handle: $handle }) {
    id
    handle
    trackProducts: field(key: "track_products") { value }
    ucProducts: field(key: "uc_products") { value }
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

PRODUCTS_PAGE = """
query ProductsPage($cursor: String) {
  products(first: 250, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id handle }
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
        "shopify", "store", "execute",
        "--store", STORE,
        "--query", query,
        "--json",
    ]
    if mutation:
        cmd.append("--allow-mutations")
    if variables:
        cmd.extend(["--variables", json.dumps(variables)])
    env = {
        **dict(os.environ),
        "SHOPIFY_CLI_AGENT_INFO": "n:cursor|v:1|p:cursor",
        "SHOPIFY_CLI_AGENT_IDS": "s:sync-model-refs|r:script|i:1",
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


def product_bucket(fit_type: str, product_code: str) -> str:
    """Map fitment row → Model metaobject list field."""
    code = (product_code or "").upper()
    if fit_type == "track" or code.startswith("TNT") or code.startswith("BS"):
        return "track_products"
    return "uc_products"


MANIFEST_PATH = ROOT / "data" / "shopify-canonical-handles.json"


def load_canonical_handle_map() -> dict[str, str]:
    """itemid -> Shopify handle from reconcile manifest (optional)."""
    if not MANIFEST_PATH.is_file():
        return {}
    try:
        data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        return {
            iid.upper(): (info.get("handle") or "").strip()
            for iid, info in (data.get("itemids") or {}).items()
            if info.get("handle")
        }
    except (json.JSONDecodeError, OSError):
        return {}


def load_shopify_handle_map(canonical_by_itemid: dict[str, str] | None = None) -> dict[str, str]:
    """Current-store handle → product GID (avoids stale Supabase GIDs)."""
    by_handle: dict[str, str] = {}
    cursor: str | None = None
    while True:
        data = shopify_gql(PRODUCTS_PAGE, {"cursor": cursor})
        conn = data.get("products") or {}
        for node in conn.get("nodes") or []:
            handle = (node.get("handle") or "").strip()
            gid = (node.get("id") or "").strip()
            if handle and gid:
                by_handle[handle] = gid
        page = conn.get("pageInfo") or {}
        if not page.get("hasNextPage"):
            break
        cursor = page.get("endCursor")
    return by_handle


def resolve_store_gid(
    product: dict,
    handle_map: dict[str, str],
    canonical_by_itemid: dict[str, str],
) -> str | None:
    """Resolve via canonical handle (manifest) or Supabase handle → live store GID."""
    code = (product.get("product_code") or "").upper()
    handle = canonical_by_itemid.get(code) or (product.get("handle") or "").strip()
    if not handle:
        return None
    return handle_map.get(handle)


def load_fitment_groups(
    handle_map: dict[str, str],
    canonical_by_itemid: dict[str, str],
) -> tuple[dict[str, dict], dict[str, int]]:
    """Group distinct product GIDs by model_key → {track_products, uc_products}."""
    rows = supabase_get_all(FITMENT_SELECT)
    by_model: dict[str, dict] = defaultdict(
        lambda: {
            "model_key": "",
            "model_handle": "",
            "model_gid": "",
            "track_products": set(),
            "uc_products": set(),
        }
    )
    stats = {
        "rows": len(rows),
        "skipped_no_model": 0,
        "skipped_no_product_gid": 0,
        "skipped_not_in_store": 0,
    }

    for row in rows:
        model = row.get("model") or {}
        product = row.get("product") or {}
        model_key = (model.get("model_key") or "").strip()
        if not model_key:
            stats["skipped_no_model"] += 1
            continue

        gid = resolve_store_gid(product, handle_map, canonical_by_itemid)
        if not gid:
            if product.get("handle"):
                stats["skipped_not_in_store"] += 1
            else:
                stats["skipped_no_product_gid"] += 1
            continue

        bucket = product_bucket(row.get("fit_type") or "", product.get("product_code") or "")
        entry = by_model[model_key]
        entry["model_key"] = model_key
        entry["model_handle"] = (model.get("model_handle") or model_key).strip()
        if model.get("shopify_metaobject_gid"):
            entry["model_gid"] = model["shopify_metaobject_gid"]
        entry[bucket].add(gid)

    return dict(by_model), stats


def resolve_model_gid(handle: str, cached_gid: str, cache: dict[str, str]) -> str | None:
    if cached_gid:
        return cached_gid
    if handle in cache:
        return cache[handle]
    data = shopify_gql(MO_BY_HANDLE, {"handle": handle})
    mo = data.get("metaobjectByHandle")
    gid = (mo or {}).get("id")
    if gid:
        cache[handle] = gid
    return gid


def sorted_gids(gids: set[str]) -> list[str]:
    return sorted(gids)


def fields_payload(track_gids: list[str], uc_gids: list[str]) -> list[dict]:
    fields: list[dict] = []
    if track_gids is not None:
        fields.append({"key": "track_products", "value": json.dumps(track_gids)})
    if uc_gids is not None:
        fields.append({"key": "uc_products", "value": json.dumps(uc_gids)})
    return fields


def update_model(
    model_gid: str,
    track_gids: list[str],
    uc_gids: list[str],
    apply: bool,
) -> dict:
    if not apply:
        return {"dry_run": True, "track": len(track_gids), "uc": len(uc_gids)}
    data = shopify_gql(
        MO_UPDATE,
        {"id": model_gid, "fields": fields_payload(track_gids, uc_gids)},
        mutation=True,
    )
    payload = data.get("metaobjectUpdate") or {}
    errs = payload.get("userErrors") or []
    if errs:
        raise RuntimeError("; ".join(f"{e.get('field')}: {e.get('message')}" for e in errs))
    return {"updated": True, "track": len(track_gids), "uc": len(uc_gids)}


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser(description="Sync Supabase fitment → Model metaobject product lists")
    ap.add_argument("--dry-run", action="store_true", help="Report only (default)")
    ap.add_argument("--apply", action="store_true", help="Write to Shopify Model metaobjects")
    ap.add_argument("--handle", help="Single model handle / model_key (e.g. case-tv450b)")
    ap.add_argument("--limit", type=int, default=0, help="Max models to update")
    ap.add_argument("--only-changed", action="store_true", help="Skip models whose product lists already match")
    args = ap.parse_args()
    apply = args.apply and not args.dry_run

    if not supabase_key():
        print("FAIL: SUPABASE_SERVICE_ROLE_KEY required (./scripts/fitment bootstrap)", file=sys.stderr)
        return 1

    print("Loading Shopify product index …", file=sys.stderr)
    canonical = load_canonical_handle_map()
    if canonical:
        print(f"  canonical manifest: {len(canonical)} itemids", file=sys.stderr)
    handle_map = load_shopify_handle_map()
    print(f"  {len(handle_map)} products in {STORE}", file=sys.stderr)

    print("Loading fitment graph from Supabase …", file=sys.stderr)
    by_model, load_stats = load_fitment_groups(handle_map, canonical)
    print(
        f"  {load_stats['rows']} fitment rows → {len(by_model)} models "
        f"(skipped {load_stats['skipped_no_product_gid']} without handle/GID, "
        f"{load_stats['skipped_not_in_store']} not in store)",
        file=sys.stderr,
    )

    targets = sorted(by_model.values(), key=lambda m: m["model_key"])
    if args.handle:
        h = args.handle.strip()
        targets = [m for m in targets if m["model_key"] == h or m["model_handle"] == h]
        if not targets:
            print(f"No fitment data for model: {h}", file=sys.stderr)
            return 1

    gid_cache: dict[str, str] = {}
    results = {"updated": 0, "unchanged": 0, "skipped_no_mo": 0, "errors": 0, "planned": 0}

    for entry in targets:
        if args.limit and results["updated"] + results["planned"] >= args.limit and not apply:
            break
        if args.limit and results["updated"] >= args.limit and apply:
            break

        handle = entry["model_handle"] or entry["model_key"]
        track_gids = sorted_gids(entry["track_products"])
        uc_gids = sorted_gids(entry["uc_products"])
        if not track_gids and not uc_gids:
            continue

        model_gid = resolve_model_gid(handle, entry["model_gid"], gid_cache)
        if not model_gid:
            results["skipped_no_mo"] += 1
            print(f"SKIP  {handle}: no Shopify Model metaobject", file=sys.stderr)
            continue

        if args.only_changed and apply:
            mo = shopify_gql(MO_BY_HANDLE, {"handle": handle}).get("metaobjectByHandle") or {}
            current_track = parse_gid_list((mo.get("trackProducts") or {}).get("value"))
            current_uc = parse_gid_list((mo.get("ucProducts") or {}).get("value"))
            if current_track == track_gids and current_uc == uc_gids:
                results["unchanged"] += 1
                continue

        results["planned"] += 1
        label = f"{handle}: {len(track_gids)} tracks, {len(uc_gids)} UC"
        try:
            out = update_model(model_gid, track_gids, uc_gids, apply)
            if apply:
                results["updated"] += 1
                print(f"OK    {label}", file=sys.stderr)
                time.sleep(SLEEP_SEC)
            else:
                print(f"PLAN  {label}", file=sys.stderr)
        except Exception as e:
            results["errors"] += 1
            print(f"ERR   {handle}: {e}", file=sys.stderr)

    mode = "apply" if apply else "dry-run"
    print(
        f"\nDone ({mode}): planned={results['planned']} updated={results['updated']} "
        f"unchanged={results['unchanged']} skipped_no_mo={results['skipped_no_mo']} "
        f"errors={results['errors']}",
        file=sys.stderr,
    )
    return 0 if results["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
