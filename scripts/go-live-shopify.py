#!/usr/bin/env python3
"""Apply go-live Admin changes via Shopify CLI store execute.

Prerequisites:
  shopify store auth --store tracktech-530.myshopify.com \\
    --scopes read_products,write_products,read_content,write_content,read_metaobjects,write_metaobjects

Usage:
  python3 scripts/go-live-shopify.py --dry-run
  python3 scripts/go-live-shopify.py --apply
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

STORE = "tracktech-530.myshopify.com"
ROOT = Path(__file__).resolve().parents[1]
FITMENT_CSV = ROOT / "data" / "matrixify-fitment-import-batch-1.csv"
SEO_CSV = ROOT / "data" / "matrixify-model-seo-top50.csv"

# Fitment rows filled from track-fitment-map.json + audit siblings where CSV was empty
FITMENT_OVERRIDES: dict[str, str] = {
    "300x52-5x74-rubber-track-mx": "model.bobcat-225, model.bobcat-325, model.bobcat-328",
    "300x52-5x84-rubber-track-mx": "model.jcb-802-7, model.wacker-neuson-ez36, model.komatsu-pc30mr, model.bobcat-e35, model.komatsu-pc35mr",
    "350x75-5x74-rubber-track-mx": "model.yanmar-vio55-5",
    "400x72-5x70-rubber-track-mx": "model.ihi-is-40g, model.ihi-is-40gx, model.ihi-is-40gx-2, model.ihi-is-40gx-3, model.ihi-is-40j, model.ihi-is-40jx",
    "300x52-5k-nx78-rubber-track-directional": "model.case-cx26c, model.case-cx22b, model.case-cx20b, model.case-cx26, model.bobcat-e25, model.case-cx25",
    "400x86x52-rubber-track-z-max": (
        "model.bobcat-t200, model.bobcat-t630, model.bobcat-t650, model.cat-255, "
        "model.john-deere-323d, model.john-deere-325g, model.kioti-tl750, model.kubota-svl65-2, "
        "model.kubota-svl75-2, model.kubota-svl75-3, model.kubota-svl90, model.takeuchi-tl10v2, model.takeuchi-tl8r2"
    ),
}


def shopify_gql(query: str, variables: dict | None = None, allow_mutations: bool = False) -> dict:
    cmd = [
        "shopify", "store", "execute",
        "--store", STORE,
        "--query", query,
        "--json",
    ]
    if variables:
        cmd.extend(["--variables", json.dumps(variables)])
    if allow_mutations:
        cmd.append("--allow-mutations")
    env = {
        **dict(__import__("os").environ),
        "SHOPIFY_CLI_AGENT_INFO": "n:cursor|v:1|p:cursor",
        "SHOPIFY_CLI_AGENT_IDS": "s:go-live|r:script|i:1",
    }
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout)
    return json.loads(r.stdout)


def gql_data(payload: dict, *keys: str):
    """Shopify CLI --json returns fields at the top level, not under data."""
    cur = payload
    for key in keys:
        if cur is None:
            return None
        cur = cur.get(key)
    return cur


def ensure_page(dry_run: bool) -> None:
    q = 'query { pages(first:1, query:"handle:track-finder") { nodes { id handle templateSuffix } } }'
    if dry_run:
        print("[dry-run] would ensure page track-finder")
        return
    data = shopify_gql(q)
    if gql_data(data, "pages", "nodes"):
        print("Track Finder page already exists")
        return
    mutation = """
    mutation($page: PageCreateInput!) {
      pageCreate(page: $page) {
        page { id handle templateSuffix }
        userErrors { field message }
      }
    }
    """
    variables = {
        "page": {
            "title": "Track Finder",
            "handle": "track-finder",
            "templateSuffix": "track-finder",
            "body": "<p>Find the exact rubber track for your machine.</p>",
        }
    }
    res = shopify_gql(mutation, variables, allow_mutations=True)
    errs = gql_data(res, "pageCreate", "userErrors") or []
    if errs:
        raise RuntimeError(f"pageCreate: {errs}")
    print("Created Track Finder page")


MTL_HANDLES = [
    "450x100x48-rubber-track-c-block",
    "450x100x48-rubber-track-zig-zag",
    "450x100x48-rubber-track-multi-bar",
    "450x100x50-rubber-track-c-block",
    "450x100x50-rubber-track-zig-zag",
    "450x100x50-rubber-track-multi-bar",
    "320x86x46-rubber-track-c-block",
    "381x101-6x42-rubber-track-multi-bar",
    "381x101-6x51-rubber-track-multi-bar",
    "heavy-duty-13-rubber-track-320x86tx52",
    "320x86x52-rubber-tracks",
    "320x86x52-rubber-track-c-block",
]


def tag_mtl_products(dry_run: bool) -> None:
    for handle in MTL_HANDLES:
        pq = f'query {{ productByHandle(handle:"{handle}") {{ id tags }} }}'
        pdata = shopify_gql(pq)
        product = gql_data(pdata, "productByHandle")
        if not product:
            print(f"WARN: MTL product not found: {handle}")
            continue
        tags = list(product.get("tags") or [])
        changed = False
        for tag in ("Multi-Terrain Loader", "Rubber Tracks"):
            if tag not in tags:
                tags.append(tag)
                changed = True
        if not changed:
            print(f"MTL tags ok: {handle}")
            continue
        if dry_run:
            print(f"[dry-run] tag MTL: {handle}")
            continue
        mutation = """
        mutation($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id handle }
            userErrors { message }
          }
        }
        """
        res = shopify_gql(mutation, {"input": {"id": product["id"], "tags": tags}}, allow_mutations=True)
        errs = gql_data(res, "productUpdate", "userErrors") or []
        if errs:
            print(f"WARN tag {handle}: {errs}")
        else:
            print(f"Tagged MTL: {handle}")


def ensure_collection(dry_run: bool, handle: str, title: str, tag: str, product_type: str = "Rubber Tracks") -> None:
    q = f'query {{ collectionByHandle(handle:"{handle}") {{ id handle productsCount {{ count }} }} }}'
    if dry_run:
        print(f"[dry-run] would ensure collection {handle} (tag={tag})")
        return
    data = shopify_gql(q)
    existing = gql_data(data, "collectionByHandle")
    if existing:
        print(f"Collection {handle} already exists ({existing.get('productsCount', {}).get('count', '?')} products)")
        return
    mutation = """
    mutation($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection { id handle productsCount { count } }
        userErrors { field message }
      }
    }
    """
    variables = {
        "input": {
            "title": title,
            "handle": handle,
            "ruleSet": {
                "appliedDisjunctively": False,
                "rules": [
                    {"column": "TYPE", "relation": "EQUALS", "condition": product_type},
                    {"column": "TAG", "relation": "EQUALS", "condition": tag},
                ],
            },
        }
    }
    res = shopify_gql(mutation, variables, allow_mutations=True)
    errs = gql_data(res, "collectionCreate", "userErrors") or []
    if errs:
        if any("already been taken" in (e.get("message") or "") for e in errs):
            print(f"Collection {handle} already exists (handle taken)")
            return
        raise RuntimeError(f"collectionCreate {handle}: {errs}")
    print(f"Created collection {handle}")


def load_fitment_rows() -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    with FITMENT_CSV.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            handle = row["Handle"].strip()
            refs = (row.get("Metafield: custom.fits_equipment_models [list.metaobject_reference]") or "").strip()
            if not refs:
                refs = FITMENT_OVERRIDES.get(handle, "")
            if refs:
                rows.append((handle, refs))
    return rows


def apply_product_fitment(dry_run: bool, handle: str, refs_csv: str) -> None:
    refs = [f"gid://shopify/Metaobject/{r.split('.', 1)[1]}" if r.startswith("model.") else r for r in refs_csv.split(",")]
    # Resolve metaobject GIDs by handle query instead
    model_handles = [r.strip().replace("model.", "") for r in refs_csv.split(",") if r.strip()]
    if dry_run:
        print(f"[dry-run] fitment {handle}: {len(model_handles)} models")
        return

    pq = f'query {{ productByHandle(handle:"{handle}") {{ id }} }}'
    pdata = shopify_gql(pq)
    product = gql_data(pdata, "productByHandle")
    if not product:
        print(f"WARN: product not found: {handle}")
        return

    gids: list[str] = []
    for mh in model_handles:
        mq = f'query {{ metaobjectByHandle(handle: {{type: "model", handle: "{mh}"}}) {{ id }} }}'
        mdata = shopify_gql(mq)
        mo = gql_data(mdata, "metaobjectByHandle")
        if mo:
            gids.append(mo["id"])
        else:
            print(f"WARN: model metaobject missing: {mh}")

    if not gids:
        return

    mutation = """
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }
    """
    variables = {
        "metafields": [{
            "ownerId": product["id"],
            "namespace": "custom",
            "key": "fits_equipment_models",
            "type": "list.metaobject_reference",
            "value": json.dumps(gids),
        }]
    }
    res = shopify_gql(mutation, variables, allow_mutations=True)
    errs = gql_data(res, "metafieldsSet", "userErrors") or []
    if errs:
        raise RuntimeError(f"metafieldsSet {handle}: {errs}")
    print(f"Updated fitment: {handle} ({len(gids)} models)")


def apply_model_seo(dry_run: bool) -> None:
    with SEO_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            handle = row["Handle"].strip()
            title = row["Field: seo_title"].strip()
            desc = row["Field: seo_description"].strip()
            if dry_run:
                print(f"[dry-run] SEO {handle}")
                continue
            mq = f'query {{ metaobjectByHandle(handle: {{type: "model", handle: "{handle}"}}) {{ id }} }}'
            mdata = shopify_gql(mq)
            mo = gql_data(mdata, "metaobjectByHandle")
            if not mo:
                print(f"WARN: model not found: {handle}")
                continue
            mutation = """
            mutation($id: ID!, $fields: [MetaobjectFieldInput!]!) {
              metaobjectUpdate(id: $id, metaobject: {fields: $fields}) {
                metaobject { id }
                userErrors { field message }
              }
            }
            """
            variables = {
                "id": mo["id"],
                "fields": [
                    {"key": "seo_title", "value": title},
                    {"key": "seo_description", "value": desc},
                ],
            }
            res = shopify_gql(mutation, variables, allow_mutations=True)
            errs = gql_data(res, "metaobjectUpdate", "userErrors") or []
            if errs:
                print(f"WARN SEO {handle}: {errs}")
            else:
                print(f"Updated SEO: {handle}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    dry_run = not args.apply

    ensure_page(dry_run)
    ensure_collection(dry_run, "skid-steers", "Skid Steer Tracks", "Skid Steer")
    tag_mtl_products(dry_run)
    ensure_collection(dry_run, "multi-terrain-loaders", "Multi-Terrain Loader Tracks", "Multi-Terrain Loader")

    # Fitment: use Supabase sync → custom.fitments (scripts/consolidate-fitment.sh).
    # Legacy Matrixify fits_equipment_models import removed — single source of truth.

    apply_model_seo(dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
