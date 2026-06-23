#!/usr/bin/env python3
"""Export My Fleet clean data → Matrixify Model metaobject CSV + Shopify API manifest.

Reads dev Supabase (zhdqdxtwipcowbtdyviq) fleet views — never production fitment tables.

Outputs (data/model-publish/):
  matrixify-model-publish.csv   — Matrixify MERGE for Model metaobjects
  model-publish-report.csv      — audit per machine
  shopify-api-manifest.json     — track_products / uc_products GIDs for API apply

Usage:
  python3 scripts/export-model-publish-bundle.py
  python3 scripts/export-model-publish-bundle.py --limit 20
  python3 scripts/apply-model-publish-bundle.py --dry-run
  python3 scripts/apply-model-publish-bundle.py --apply --handle john-deere-323e
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

OUT_DIR = ROOT / "data" / "model-publish"
MATRIXIFY_CSV = OUT_DIR / "matrixify-model-publish.csv"
REPORT_CSV = OUT_DIR / "model-publish-report.csv"
API_MANIFEST = OUT_DIR / "shopify-api-manifest.json"

STORE = os.environ.get("SHOPIFY_STORE_DOMAIN", "tracktech-530.myshopify.com")

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


def shopify_gql_cli(query: str, variables: dict | None = None) -> dict:
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
    if variables:
        cmd.extend(["--variables", json.dumps(variables)])
    env = {
        **dict(os.environ),
        "SHOPIFY_CLI_AGENT_INFO": "n:cursor|v:1|p:cursor",
        "SHOPIFY_CLI_AGENT_IDS": "s:export-model-publish|r:script|i:1",
    }
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout)
    return json.loads(r.stdout)


def load_shopify_handle_map() -> dict[str, str]:
    by_handle: dict[str, str] = {}
    cursor: str | None = None
    while True:
        data = shopify_gql_cli(PRODUCTS_PAGE, {"cursor": cursor})
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


def main() -> int:
    ap = argparse.ArgumentParser(description="Export Model publish bundle from dev My Fleet spine")
    ap.add_argument("--limit", type=int, default=0, help="Limit models in export")
    ap.add_argument("--skip-shopify-index", action="store_true", help="Skip live Shopify product index (manifest GIDs empty)")
    args = ap.parse_args()

    load_env()

    import psycopg
    from lib.dev_supabase import get_dev_postgres_url
    from lib.model_publish import (
        fetch_publish_rows,
        write_api_manifest,
        write_matrixify_csv,
        write_report_csv,
    )

    print("Loading publish rows from dev Supabase …", flush=True)
    with psycopg.connect(get_dev_postgres_url()) as conn:
        rows = fetch_publish_rows(conn)

    if args.limit:
        rows = rows[: args.limit]

    handle_map: dict[str, str] = {}
    if not args.skip_shopify_index:
        try:
            print(f"Indexing products on {STORE} …", flush=True)
            handle_map = load_shopify_handle_map()
            print(f"  {len(handle_map)} product handles", flush=True)
        except Exception as e:
            print(f"WARN: Shopify index failed ({e}); manifest will omit GIDs", file=sys.stderr)

    n_matrixify = write_matrixify_csv(MATRIXIFY_CSV, rows)
    write_report_csv(REPORT_CSV, rows)
    write_api_manifest(API_MANIFEST, rows, handle_map)

    ready = sum(1 for r in rows if r.status == "ready")
    partial = sum(1 for r in rows if r.status == "partial")
    review = sum(1 for r in rows if r.status == "review")
    with_hero = sum(1 for r in rows if r.hero_url)
    with_tracks = sum(1 for r in rows if r.track_product_handles)

    print(f"Models: {len(rows)} (ready={ready} partial={partial} review={review})")
    print(f"With hero: {with_hero} | with track products: {with_tracks}")
    print(f"Wrote {MATRIXIFY_CSV} ({n_matrixify} Matrixify rows)")
    print(f"Wrote {REPORT_CSV}")
    print(f"Wrote {API_MANIFEST}")
    print("\nNext:")
    print("  1. Matrixify → Import → matrixify-model-publish.csv (Metaobjects: model, MERGE)")
    print("  2. python3 scripts/apply-model-publish-bundle.py --apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
