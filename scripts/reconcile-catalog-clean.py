#!/usr/bin/env python3
"""Reconcile Heavy Iron catalog → one SSOT: itemid keys, Shopify handles from export.

Reads canonical Shopify export (Products.csv) + optional TrackTech xlsx.
Patches Supabase handles, purges legacy fitment sources, writes manifest for sync scripts.

Usage:
  python3 scripts/reconcile-catalog-clean.py audit
  python3 scripts/reconcile-catalog-clean.py audit --shopify-csv ~/Desktop/SUPABASE/Products.csv

  python3 scripts/reconcile-catalog-clean.py align-handles --dry-run
  python3 scripts/reconcile-catalog-clean.py align-handles --apply

  python3 scripts/reconcile-catalog-clean.py purge-legacy-fitments --dry-run
  python3 scripts/reconcile-catalog-clean.py purge-legacy-fitments --apply

  python3 scripts/reconcile-catalog-clean.py clean --apply
    # align-handles + purge-legacy-fitments + write manifest
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from lib.catalog_ssot import (  # noqa: E402
    load_dotenv_fitment,
    supabase_get_all,
    supabase_key,
    supabase_request,
    supabase_url,
)

DEFAULT_SHOPIFY_CSV = Path.home() / "Desktop/SUPABASE/Products.csv"
DEFAULT_TT_XLSX = Path.home() / "Desktop/SUPABASE/tracktech-products-2026-06-21T22-38-21.xlsx"
MANIFEST_PATH = ROOT / "data" / "shopify-canonical-handles.json"
STORE = os.environ.get("SHOPIFY_STORE_DOMAIN", "tracktech-530.myshopify.com")
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-10")
KEEP_FITMENT_SOURCES = frozenset({"tracktech_export"})


def load_shopify_canonical(path: Path) -> dict[str, dict]:
    """itemid -> {handle, part_type}."""
    out: dict[str, dict] = {}
    if not path.is_file():
        raise FileNotFoundError(path)
    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            handle = (row.get("Handle") or "").strip()
            itemid = ""
            for k, v in row.items():
                if "tracktech_itemid" in k.lower() and (v or "").strip():
                    itemid = v.strip().upper()
                    break
            if not itemid:
                itemid = (row.get("Variant SKU") or "").strip().upper()
            if not itemid:
                continue
            if itemid not in out:
                out[itemid] = {
                    "handle": handle,
                    "part_type": (row.get("Metafield: custom.part_type [single_line_text_field]") or "").strip(),
                }
    return out


def shopify_handle_index() -> dict[str, str]:
    """handle -> product GID."""
    index: dict[str, str] = {}
    cursor: str | None = None
    query = """
    query Products($cursor: String) {
      products(first: 250, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id handle }
      }
    }
    """
    while True:
        try:
            data = _shopify_gql(query, {"cursor": cursor})
        except Exception:
            break
        conn = data.get("products") or {}
        for node in conn.get("nodes") or []:
            h = (node.get("handle") or "").strip()
            gid = (node.get("id") or "").strip()
            if h and gid:
                index[h] = gid
        page = conn.get("pageInfo") or {}
        if not page.get("hasNextPage"):
            break
        cursor = page.get("endCursor")
    return index


def _shopify_gql(query: str, variables: dict | None = None) -> dict:
    token = os.environ.get("SHOPIFY_ADMIN_TOKEN")
    if token:
        import urllib.request

        body = json.dumps({"query": query, "variables": variables or {}}).encode()
        req = urllib.request.Request(
            f"https://{STORE}/admin/api/{API_VERSION}/graphql.json",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json", "X-Shopify-Access-Token": token},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return _shopify_gql_cli(query, variables)
            raise
        if payload.get("errors"):
            raise RuntimeError(json.dumps(payload["errors"]))
        return payload.get("data") or payload
    return _shopify_gql_cli(query, variables)


def _shopify_gql_cli(query: str, variables: dict | None = None) -> dict:
    cmd = ["shopify", "store", "execute", "--store", STORE, "--query", query, "--json"]
    if variables:
        cmd.extend(["--variables", json.dumps(variables)])
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout)
    return json.loads(r.stdout)


def write_manifest(canonical: dict[str, dict], handle_gids: dict[str, str]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "store": STORE,
        "source_csv": str(DEFAULT_SHOPIFY_CSV),
        "itemids": {
            iid: {
                "handle": info["handle"],
                "part_type": info.get("part_type") or "",
                "shopify_product_id": handle_gids.get(info["handle"]),
            }
            for iid, info in sorted(canonical.items())
        },
    }
    MANIFEST_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {MANIFEST_PATH} ({len(payload['itemids'])} itemids)")


def cmd_audit(args: argparse.Namespace) -> int:
    csv_path = Path(args.shopify_csv)
    canonical = load_shopify_canonical(csv_path)
    db = supabase_get_all("product?select=id,product_code,handle,shopify_product_id&source=eq.itemid_ssot")
    db_map = {p["product_code"].upper(): p for p in db if p.get("product_code")}

    print("=== Catalog audit ===")
    print(f"  Shopify canonical CSV: {csv_path.name} ({len(canonical)} itemids)")
    print(f"  Supabase products:     {len(db_map)}")

    shared = set(canonical) & set(db_map)
    print(f"  itemid overlap:        {len(shared)}")
    print(f"  CSV only:              {len(set(canonical) - set(db_map))}")
    print(f"  Supabase only:         {len(set(db_map) - set(canonical))}")

    handle_bad = sum(1 for i in shared if db_map[i].get("handle") != canonical[i]["handle"])
    print(f"  handle mismatches:     {handle_bad}/{len(shared)}")

    fit = supabase_get_all("fitment?select=source")
    src = Counter(r.get("source") for r in fit)
    print(f"\n  Fitment rows: {len(fit)}")
    for s, n in src.most_common():
        mark = "keep" if s in KEEP_FITMENT_SOURCES else "purge"
        print(f"    {s}: {n} ({mark})")
    legacy = sum(n for s, n in src.items() if s not in KEEP_FITMENT_SOURCES)
    print(f"  Legacy fitment rows to purge: {legacy}")

    if args.shopify_live:
        try:
            live = shopify_handle_index()
            in_store = sum(1 for i, info in canonical.items() if info["handle"] in live)
            print(f"\n  Canonical handles in live {STORE}: {in_store}/{len(canonical)}")
        except Exception as e:
            print(f"\n  Live store check skipped: {e}")
    return 0


def cmd_align_handles(args: argparse.Namespace) -> int:
    canonical = load_shopify_canonical(Path(args.shopify_csv))
    db = supabase_get_all("product?select=id,product_code,handle,shopify_product_id&source=eq.itemid_ssot")
    handle_gids = shopify_handle_index() if args.apply else {}

    patched = skipped = 0
    for row in db:
        code = (row.get("product_code") or "").upper()
        if code not in canonical:
            continue
        want_handle = canonical[code]["handle"]
        want_gid = handle_gids.get(want_handle) if args.apply else None
        cur_handle = row.get("handle") or ""
        cur_gid = row.get("shopify_product_id") or ""
        if cur_handle == want_handle and (not want_gid or cur_gid == want_gid):
            skipped += 1
            continue
        patched += 1
        if args.apply:
            body: dict = {"handle": want_handle}
            if want_gid:
                body["shopify_product_id"] = want_gid
            pid = row["id"]
            supabase_request(
                "PATCH",
                f"product?id=eq.{urllib.parse.quote(str(pid), safe='')}",
                body=body,
                prefer="return=minimal",
            )
        else:
            print(f"  PLAN {code}: {cur_handle!r} → {want_handle!r}")

    mode = "apply" if args.apply else "dry-run"
    print(f"\nalign-handles ({mode}): patch={patched} unchanged={skipped}")
    if args.apply:
        write_manifest(canonical, handle_gids)
    return 0


def cmd_purge_legacy_fitments(args: argparse.Namespace) -> int:
    fit = supabase_get_all("fitment?select=id,source")
    legacy_ids = [r["id"] for r in fit if r.get("source") not in KEEP_FITMENT_SOURCES]
    keep = len(fit) - len(legacy_ids)
    print(f"purge-legacy-fitments: keep {keep}, delete {len(legacy_ids)}")
    if not legacy_ids:
        return 0
    if not args.apply:
        print("[dry-run] Use --apply to delete legacy fitment rows.")
        return 0
    chunk = 200
    deleted = 0
    for i in range(0, len(legacy_ids), chunk):
        part = ",".join(str(x) for x in legacy_ids[i : i + chunk])
        supabase_request("DELETE", f"fitment?id=in.({part})", prefer="return=minimal")
        deleted += min(chunk, len(legacy_ids) - i)
    print(f"Deleted {deleted} legacy fitment rows.")
    return 0


def cmd_clean(args: argparse.Namespace) -> int:
    if not args.apply:
        args.dry_run = True
    audit_args = argparse.Namespace(shopify_csv=args.shopify_csv, shopify_live=True)
    cmd_audit(audit_args)
    print()
    align_args = argparse.Namespace(shopify_csv=args.shopify_csv, apply=args.apply)
    cmd_align_handles(align_args)
    print()
    purge_args = argparse.Namespace(apply=args.apply)
    cmd_purge_legacy_fitments(purge_args)
    if args.apply:
        print("\nNext:")
        print(f"  python3 scripts/import-fitments-from-tracktech-export.py --apply --export {DEFAULT_TT_XLSX}")
        print("  ./scripts/fitment sync")
    return 0


def main() -> int:
    load_dotenv_fitment()
    if not supabase_key():
        print("Run ./scripts/fitment bootstrap", file=sys.stderr)
        return 1

    ap = argparse.ArgumentParser(description="Reconcile catalog to one SSOT")
    ap.add_argument("--shopify-csv", default=str(DEFAULT_SHOPIFY_CSV))
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_audit = sub.add_parser("audit", help="Report gaps and legacy fitment sources")
    p_audit.add_argument("--shopify-live", action="store_true", help="Check handles against live store")
    p_audit.set_defaults(func=cmd_audit)

    p_align = sub.add_parser("align-handles", help="Patch Supabase handles from Shopify CSV")
    p_align.add_argument("--dry-run", action="store_true")
    p_align.add_argument("--apply", action="store_true")
    p_align.set_defaults(func=cmd_align_handles)

    p_purge = sub.add_parser("purge-legacy-fitments", help="Delete non-tracktech_export fitment rows")
    p_purge.add_argument("--dry-run", action="store_true")
    p_purge.add_argument("--apply", action="store_true")
    p_purge.set_defaults(func=cmd_purge_legacy_fitments)

    p_clean = sub.add_parser("clean", help="audit + align-handles + purge legacy fitments")
    p_clean.add_argument("--dry-run", action="store_true")
    p_clean.add_argument("--apply", action="store_true")
    p_clean.set_defaults(func=cmd_clean)

    args = ap.parse_args()
    if hasattr(args, "func"):
        if getattr(args, "dry_run", False) and getattr(args, "apply", False):
            args.apply = False
        return args.func(args)
    ap.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
