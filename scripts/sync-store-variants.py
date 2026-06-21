#!/usr/bin/env python3
"""Sync Shopify variant SKUs (itemids) → Supabase store_variant_map.

Mirrors edge function sync-store-variants but uses Shopify CLI auth locally
(no Supabase SHOPIFY_HEAVY_IRON_* secrets required).

Usage:
  python3 scripts/sync-store-variants.py --dry-run
  python3 scripts/sync-store-variants.py --apply
  python3 scripts/sync-store-variants.py --apply --store heavy_iron --shop tracktech-530.myshopify.com
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from lib.catalog_ssot import supabase_get_all, supabase_key, supabase_request, supabase_url  # noqa: E402

DEFAULT_SHOP = os.environ.get("SHOPIFY_STORE_DOMAIN", "tracktech-530.myshopify.com")
MAX_PAGES = 30

VARIANTS_PAGE = """
query VariantsPage($after: String) {
  productVariants(first: 250, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      sku
      price
      compareAtPrice
      id
      product { id }
    }
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


def shopify_gql_cli(shop: str, query: str, variables: dict | None = None) -> dict:
    cmd = [
        "shopify", "store", "execute",
        "--store", shop,
        "--query", query,
        "--json",
    ]
    if variables:
        cmd.extend(["--variables", json.dumps(variables)])
    env = {
        **dict(os.environ),
        "SHOPIFY_CLI_AGENT_INFO": "n:cursor|v:1|p:cursor",
        "SHOPIFY_CLI_AGENT_IDS": "s:sync-variants|r:script|i:1",
    }
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout)
    return json.loads(r.stdout)


def shopify_gql_http(shop: str, token: str, query: str, variables: dict | None = None) -> dict:
    version = os.environ.get("SHOPIFY_API_VERSION", "2024-10")
    url = f"https://{shop}/admin/api/{version}/graphql.json"
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": token},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read())
    if payload.get("errors"):
        raise RuntimeError(json.dumps(payload["errors"]))
    return payload.get("data") or payload


def shopify_gql(shop: str, query: str, variables: dict | None = None) -> dict:
    token = os.environ.get("SHOPIFY_ADMIN_TOKEN")
    if token:
        try:
            return shopify_gql_http(shop, token, query, variables)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return shopify_gql_cli(shop, query, variables)
            raise
    return shopify_gql_cli(shop, query, variables)


def fetch_variants(shop: str) -> list[dict]:
    rows: list[dict] = []
    after: str | None = None
    pages = 0
    while pages < MAX_PAGES:
        data = shopify_gql(shop, VARIANTS_PAGE, {"after": after})
        pv = data.get("productVariants") or {}
        for n in pv.get("nodes") or []:
            sku = (n.get("sku") or "").strip()
            if not sku:
                continue
            rows.append(
                {
                    "itemid": sku,
                    "shopify_variant_id": str(n["id"]).split("/")[-1],
                    "shopify_product_id": (
                        str(n["product"]["id"]).split("/")[-1] if n.get("product", {}).get("id") else None
                    ),
                    "price": float(n["price"]) if n.get("price") is not None else None,
                }
            )
        pages += 1
        page_info = pv.get("pageInfo") or {}
        if not page_info.get("hasNextPage"):
            break
        after = page_info.get("endCursor")
    return rows


def dedupe_by_itemid(rows: list[dict]) -> tuple[list[dict], int]:
    """Keep last variant per itemid (Shopify should be 1:1 but dev catalog may duplicate)."""
    by_id: dict[str, dict] = {}
    for r in rows:
        by_id[r["itemid"]] = r
    return list(by_id.values()), len(rows) - len(by_id)


def upsert_rows(store: str, rows: list[dict], apply: bool) -> int:
    if not apply:
        return len(rows)
    key = supabase_key()
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY required")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    upserted = 0
    for i in range(0, len(rows), 500):
        batch = [{**r, "store": store, "updated_at": now} for r in rows[i : i + 500]]
        url = f"{supabase_url().rstrip('/')}/rest/v1/store_variant_map"
        req = urllib.request.Request(
            url,
            data=json.dumps(batch).encode(),
            method="POST",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120):
                pass
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            raise RuntimeError(f"upsert failed ({e.code}): {body}") from e
        upserted += len(batch)
    return upserted


def main() -> None:
    load_env()
    ap = argparse.ArgumentParser(description="Sync Shopify variants → store_variant_map")
    ap.add_argument("--dry-run", action="store_true", help="Fetch only (default)")
    ap.add_argument("--apply", action="store_true", help="Upsert to Supabase")
    ap.add_argument("--store", default="heavy_iron", help="store_variant_map.store key")
    ap.add_argument("--shop", default=DEFAULT_SHOP, help="Shopify myshopify.com domain")
    args = ap.parse_args()
    apply = args.apply and not args.dry_run

    print(f"Fetching variants from {args.shop} …", file=sys.stderr)
    rows = fetch_variants(args.shop)
    rows, dupes = dedupe_by_itemid(rows)
    print(f"Fetched {len(rows)} unique itemids ({dupes} duplicate SKUs dropped)", file=sys.stderr)

    if apply:
        n = upsert_rows(args.store, rows, True)
        print(f"Upserted {n} rows into store_variant_map (store={args.store})", file=sys.stderr)
    else:
        print(f"DRY RUN — would upsert {len(rows)} rows (store={args.store})", file=sys.stderr)
        if rows[:3]:
            print("Sample:", json.dumps(rows[:3], indent=2))

    existing = supabase_get_all(f"store_variant_map?select=itemid&store=eq.{args.store}")
    print(f"Current bridge rows for {args.store}: {len(existing)}", file=sys.stderr)


if __name__ == "__main__":
    main()
