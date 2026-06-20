#!/usr/bin/env python3
"""Backfill product.shopify_product_id via Shopify handle, SKU, or normalized handle.

Supabase handles often differ from Shopify (e.g. 230x72bx45-c-block-rubber-tracks vs
230x72x45-rubber-track-c-block). Resolution order: exact handle → SKU → normalized handle.

Prerequisites:
  shopify store auth --store tracktech-530.myshopify.com
  export SUPABASE_URL=https://<project>.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=<service_role key>

Usage:
  python3 scripts/backfill-shopify-product-ids.py --dry-run
  python3 scripts/backfill-shopify-product-ids.py --apply
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

STORE = "tracktech-530.myshopify.com"
PROJECT_REF = "tcykyktvdlsbscrsbjyt"
DEFAULT_SUPABASE_URL = f"https://{PROJECT_REF}.supabase.co"

TREAD_SUFFIXES = {
    "directional": "directional",
    "multi-bar": "multi-bar",
    "c-block": "c-block",
    "zig-zag": "zig-zag",
    "mx": "mx",
    "mx-non-marking": "mx",
    "l-tread": "l-tread",
    "block": "block",
    "zb": "z-max",
    "all-terrain": "all-terrain",
    "staggered-block": "staggered-block",
    "x-terrain": "x-terrain",
    "v-pattern": "v-pattern",
    "s-lug": "s-lug",
    "nd": "nd",
    "standard": "standard",
    "offset-block": "offset-block",
    "t-bar": "t-bar",
    "fitment-reference": "directional",
}


def shopify_gql(query: str, variables: dict | None = None) -> dict:
    cmd = [
        "shopify", "store", "execute",
        "--store", STORE,
        "--query", query,
        "--json",
    ]
    if variables:
        cmd.extend(["--variables", json.dumps(variables)])
    env = {
        **dict(os.environ),
        "SHOPIFY_CLI_AGENT_INFO": "n:cursor|v:1|p:cursor",
        "SHOPIFY_CLI_AGENT_IDS": "s:backfill|r:script|i:1",
    }
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout)
    return json.loads(r.stdout)


def shopify_product_by_handle(handle: str) -> str | None:
    data = shopify_gql(
        "query ProductByHandle($handle: String!) { productByHandle(handle: $handle) { id handle } }",
        {"handle": handle},
    )
    product = data.get("productByHandle")
    return product.get("id") if product else None


def shopify_product_by_sku(sku: str) -> str | None:
    data = shopify_gql(
        "query ProductBySku($q: String!) { productVariants(first: 1, query: $q) { nodes { product { id handle } } } }",
        {"q": f"sku:{sku}"},
    )
    nodes = (data.get("productVariants") or {}).get("nodes") or []
    if nodes and nodes[0].get("product"):
        return nodes[0]["product"]["id"]
    return None


def normalize_supabase_handle(handle: str) -> str | None:
    """Map Supabase catalog handle → Shopify product handle."""
    h = handle.strip().lower()
    if not h.endswith("-rubber-tracks"):
        return None

    base = h[: -len("-rubber-tracks")]
    tread = None
    for key in sorted(TREAD_SUFFIXES, key=len, reverse=True):
        suffix = f"-{key}"
        if base.endswith(suffix):
            tread = TREAD_SUFFIXES[key]
            base = base[: -len(suffix)]
            break
    if not tread:
        return None

    # 300x52.5wx88 → 300x52-5wx88 ; collapse spaces in legacy handles
    base = re.sub(r"\s+", "", base)
    base = re.sub(r"(\d)x(\d+\.\d+)", r"\1x\2".replace(".", "-").replace("x", "x", 1), base)
    base = re.sub(r"(\d+\.\d+)", lambda m: m.group(1).replace(".", "-"), base)
    base = base.replace("bx", "x").replace("tx", "x")

    return f"{base}-rubber-track-{tread}"


def resolve_shopify_gid(handle: str, sku: str | None) -> tuple[str | None, str]:
    gid = shopify_product_by_handle(handle)
    if gid:
        return gid, "handle"

    if sku:
        gid = shopify_product_by_sku(sku.strip())
        if gid:
            return gid, "sku"

    normalized = normalize_supabase_handle(handle)
    if normalized and normalized != handle:
        gid = shopify_product_by_handle(normalized)
        if gid:
            return gid, "normalized"

    return None, "none"


def supabase_fetch_pending(url: str, key: str) -> list[dict]:
    req = urllib.request.Request(
        f"{url}/rest/v1/product?select=id,handle,sku"
        "&shopify_product_id=is.null&handle=not.is.null&order=handle",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def supabase_update_product(url: str, key: str, product_id: str, shopify_gid: str) -> None:
    body = json.dumps({"shopify_product_id": shopify_gid}).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/product?id=eq.{product_id}",
        data=body,
        method="PATCH",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req) as resp:
        resp.read()


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill product.shopify_product_id from Shopify handles")
    parser.add_argument("--dry-run", action="store_true", help="Resolve handles only; do not write to Supabase")
    parser.add_argument("--apply", action="store_true", help="Write matched GIDs to Supabase")
    parser.add_argument("--limit", type=int, default=0, help="Max rows to process (0 = all)")
    args = parser.parse_args()
    if args.dry_run and args.apply:
        print("Use --dry-run or --apply, not both.", file=sys.stderr)
        return 1
    if not args.dry_run and not args.apply:
        args.dry_run = True

    url = os.environ.get("SUPABASE_URL", DEFAULT_SUPABASE_URL)
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        print("Set SUPABASE_SERVICE_ROLE_KEY (service_role JWT).", file=sys.stderr)
        return 1

    rows = supabase_fetch_pending(url, key)
    if args.limit:
        rows = rows[: args.limit]

    matched = 0
    missing = 0
    errors: list[str] = []
    by_method: dict[str, int] = {"handle": 0, "sku": 0, "normalized": 0}

    for row in rows:
        handle = (row.get("handle") or "").strip()
        sku = (row.get("sku") or "").strip() or None
        pid = row["id"]
        if not handle:
            continue
        try:
            gid, method = resolve_shopify_gid(handle, sku)
        except Exception as e:
            errors.append(f"{handle}: {e}")
            continue
        if gid:
            matched += 1
            by_method[method] = by_method.get(method, 0) + 1
            if args.apply:
                try:
                    supabase_update_product(url, key, pid, gid)
                except urllib.error.HTTPError as e:
                    errors.append(f"{handle}: supabase {e.code} {e.read().decode()}")
            else:
                print(f"[dry-run] {handle} → {gid} ({method})")
        else:
            missing += 1
            print(f"[miss] {handle}", file=sys.stderr)

    mode = "apply" if args.apply else "dry-run"
    print(
        f"\n=== backfill ({mode}) ===\n"
        f"  candidates: {len(rows)}\n"
        f"  matched:    {matched}\n"
        f"  missing:    {missing}\n"
        f"  errors:     {len(errors)}\n"
        f"  by method:  handle={by_method.get('handle', 0)}, "
        f"sku={by_method.get('sku', 0)}, normalized={by_method.get('normalized', 0)}"
    )
    for err in errors[:10]:
        print(f"  - {err}", file=sys.stderr)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
