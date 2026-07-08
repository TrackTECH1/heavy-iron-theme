#!/usr/bin/env python3
"""Clear custom.fits_equipment_models on products that have custom.fitments set.

Single source of truth: custom.fitments (Supabase sync). Legacy Matrixify field is removed
after sync to avoid silent overrides in fitment-data.liquid.

Usage:
  shopify store auth --store tracktech-530.myshopify.com
  python3 scripts/clear-fits-equipment-models.py --dry-run
  python3 scripts/clear-fits-equipment-models.py --apply
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys

STORE = "tracktech-530.myshopify.com"
QUERY = """
query Products($cursor: String) {
  products(first: 50, after: $cursor, query: "metafields.custom.fitments:*") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      handle
      fitments: metafield(namespace: "custom", key: "fitments") { value }
      legacy: metafield(namespace: "custom", key: "fits_equipment_models") { id value }
    }
  }
}
"""
MUTATION = """
mutation ClearLegacy($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) {
    deletedMetafields { key }
    userErrors { field message }
  }
}
"""


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
        "SHOPIFY_CLI_AGENT_IDS": "s:clear-fitment|r:script|i:1",
    }
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout)
    return json.loads(r.stdout)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--backup",
        default="fits-equipment-models-backup.jsonl",
        help="JSONL file to append each deleted legacy value to before deletion (recovery trail).",
    )
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        args.dry_run = True

    # metafieldsDelete is irreversible; keep a recoverable record of every value we remove.
    backup = open(args.backup, "a", encoding="utf-8") if args.apply else None

    cursor = None
    cleared = 0
    skipped = 0
    while True:
        data = shopify_gql(QUERY, {"cursor": cursor})
        conn = data.get("products") or data.get("data", {}).get("products")
        if not conn:
            raise RuntimeError(f"Unexpected response: {data}")
        for node in conn["nodes"]:
            fitments = node.get("fitments")
            legacy = node.get("legacy")
            if not fitments or not fitments.get("value"):
                skipped += 1
                continue
            if not legacy or not legacy.get("id"):
                skipped += 1
                continue
            handle = node["handle"]
            if args.apply:
                # Persist the legacy value before deleting so the operation is recoverable.
                if backup is not None:
                    backup.write(json.dumps({
                        "handle": handle,
                        "owner_id": node["id"],
                        "legacy_metafield_id": legacy.get("id"),
                        "legacy_value": legacy.get("value"),
                    }) + "\n")
                    backup.flush()
                mut = shopify_gql(MUTATION, {
                    "metafields": [{
                        "ownerId": node["id"],
                        "namespace": "custom",
                        "key": "fits_equipment_models",
                    }],
                }, allow_mutations=True)
                payload = mut.get("metafieldsDelete") or mut.get("data", {}).get("metafieldsDelete")
                errs = (payload or {}).get("userErrors") or []
                if errs:
                    print(f"ERROR {handle}: {errs}", file=sys.stderr)
                else:
                    cleared += 1
                    print(f"Cleared legacy fitment on {handle}")
            else:
                cleared += 1
                print(f"[dry-run] would clear legacy on {handle}")
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]

    if backup is not None:
        backup.close()

    mode = "apply" if args.apply else "dry-run"
    print(f"\n=== clear fits_equipment_models ({mode}) ===\n  cleared: {cleared}\n  skipped: {skipped}")
    if args.apply:
        print(f"  backup: {args.backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
