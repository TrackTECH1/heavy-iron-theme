#!/usr/bin/env python3
"""Backfill Supabase fitment rows for catalog products with zero fitments.

Sources (in order):
  1. tracktech-source-of-truth-package/02_import_csvs/core_fitment.csv
  2. supplier_master.fitment_models (parsed make/model pairs)

Usage:
  python3 scripts/backfill-gap-fitments.py --dry-run
  python3 scripts/backfill-gap-fitments.py --apply
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

PACKAGE = ROOT / "data" / "tracktech-source-of-truth-package"
CORE_FITMENT = PACKAGE / "02_import_csvs" / "core_fitment.csv"
PRODUCT_MASTER = PACKAGE / "01_core_tables" / "product_master.csv"
MODEL_MASTER = PACKAGE / "01_core_tables" / "model_master.csv"

from lib.catalog_ssot import (  # noqa: E402
    catalog_part_family,
    is_catalog_itemid,
    load_dotenv_fitment,
    normalize_itemid,
    parse_fitment_csv,
    slugify_make,
    slugify_model,
    supabase_get_all,
    supabase_request,
    supplier_by_itemid,
)


def norm_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def load_product_id_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    with PRODUCT_MASTER.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pid = (row.get("product_id") or "").strip()
            itemid = normalize_itemid(row.get("sku") or row.get("supplier_sku") or row.get("shopify_sku"))
            if pid and itemid:
                mapping[pid] = itemid
    return mapping


def load_machine_key_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    with MODEL_MASTER.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            machine_id = (row.get("machine_id") or "").strip()
            refs = row.get("source_raw_refs") or ""
            model_key = None
            for part in str(refs).split("|"):
                if part.startswith("shopify_meta:"):
                    model_key = part.split(":", 1)[1]
                    break
            if not model_key:
                make = (row.get("brand_canonical") or row.get("brand") or "").strip()
                model = (row.get("model_canonical") or row.get("model") or "").strip()
                if make and model:
                    model_key = f"{slugify_make(make)}-{slugify_model(model)}"
            if machine_id and model_key:
                mapping[machine_id] = model_key
    return mapping


def build_model_index() -> tuple[dict[str, dict], dict[str, dict]]:
    rows = supabase_get_all("model?select=id,model_key")
    by_key = {r["model_key"]: r for r in rows if r.get("model_key")}
    by_norm = {norm_key(key): row for key, row in by_key.items()}
    return by_key, by_norm


def resolve_model(model_key: str, by_key: dict[str, dict], by_norm: dict[str, dict]) -> dict | None:
    if model_key in by_key:
        return by_key[model_key]
    return by_norm.get(norm_key(model_key))


def fit_type_for_itemid(itemid: str, product: dict) -> str:
    family = catalog_part_family(itemid, product.get("part_type") or product.get("type"))
    return "track" if family == "track" else "uc_part"


def insert_rows(rows: list[dict]) -> tuple[int, int]:
    inserted = errors = 0
    batch: list[dict] = []
    for row in rows:
        batch.append(row)
        if len(batch) >= 100:
            try:
                supabase_request(
                    "POST",
                    "fitment?on_conflict=product_id,model_id",
                    body=batch,
                    prefer="resolution=merge-duplicates,return=minimal",
                )
                inserted += len(batch)
            except Exception as exc:
                errors += len(batch)
                print(f"  batch error: {exc}", file=sys.stderr)
            batch = []
    if batch:
        try:
            supabase_request(
                "POST",
                "fitment?on_conflict=product_id,model_id",
                body=batch,
                prefer="resolution=merge-duplicates,return=minimal",
            )
            inserted += len(batch)
        except Exception as exc:
            errors += len(batch)
            print(f"  batch error: {exc}", file=sys.stderr)
    return inserted, errors


def main() -> int:
    load_dotenv_fitment()
    parser = argparse.ArgumentParser(description="Backfill zero-fitment catalog products")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.apply:
        args.dry_run = True

    if not CORE_FITMENT.is_file():
        print(f"Missing package fitment file: {CORE_FITMENT}", file=sys.stderr)
        return 1

    products = {
        normalize_itemid(row.get("itemid") or row.get("product_code")): row
        for row in supabase_get_all(
            "product?select=id,itemid,product_code,part_type,type&source=eq.itemid_ssot"
        )
    }
    fit_counts: Counter[str] = Counter()
    existing: set[tuple[str, str, str]] = set()
    for row in supabase_get_all("fitment?select=product_id,model_id,fit_type"):
        fit_counts[row["product_id"]] += 1
        existing.add((row["product_id"], row["model_id"], row["fit_type"]))

    gap_itemids = {
        itemid
        for itemid, product in products.items()
        if is_catalog_itemid(itemid)
        and catalog_part_family(itemid, product.get("part_type") or product.get("type"))
        in {"track", "sprocket", "idler", "roller"}
        and fit_counts.get(product["id"], 0) == 0
    }

    pid_to_itemid = load_product_id_map()
    machine_to_key = load_machine_key_map()
    by_key, by_norm = build_model_index()
    supplier = supplier_by_itemid()

    payloads: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    source_counts: Counter[str] = Counter()

    if CORE_FITMENT.is_file():
        with CORE_FITMENT.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                itemid = pid_to_itemid.get(row.get("product_id") or "")
                if not itemid or itemid not in gap_itemids:
                    continue
                model_key = machine_to_key.get(row.get("machine_id") or "")
                model = resolve_model(model_key, by_key, by_norm) if model_key else None
                if not model:
                    continue
                product = products[itemid]
                fit_type = fit_type_for_itemid(itemid, product)
                dedupe = (product["id"], model["id"], fit_type)
                if dedupe in existing or dedupe in seen:
                    continue
                seen.add(dedupe)
                payloads.append(
                    {
                        "product_id": product["id"],
                        "model_id": model["id"],
                        "fit_type": fit_type,
                        "source": "explicit_supplier_fitment",
                    }
                )
                source_counts["core_fitment"] += 1

    filled_itemids = {itemid for itemid in gap_itemids if products[itemid]["id"] in {p["product_id"] for p in payloads}}
    still_gap = gap_itemids - filled_itemids
    for itemid in sorted(still_gap):
        supplier_row = supplier.get(itemid) or {}
        raw = supplier_row.get("fitment_models") or ""
        if not str(raw).strip():
            continue
        product = products[itemid]
        fit_type = fit_type_for_itemid(itemid, product)
        for make, model_name in parse_fitment_csv(str(raw)):
            model_key = f"{slugify_make(make)}-{slugify_model(model_name)}"
            model = resolve_model(model_key, by_key, by_norm)
            if not model:
                continue
            dedupe = (product["id"], model["id"], fit_type)
            if dedupe in existing or dedupe in seen:
                continue
            seen.add(dedupe)
            payloads.append(
                {
                    "product_id": product["id"],
                    "model_id": model["id"],
                    "fit_type": fit_type,
                    "source": "supplier_fitment",
                }
            )
            source_counts["supplier_fitment"] += 1

    by_itemid = Counter(
        itemid
        for itemid, product in products.items()
        if product["id"] in {row["product_id"] for row in payloads}
    )

    print("=== Gap fitment backfill ===")
    print(f"  catalog products with zero fitments: {len(gap_itemids)}")
    print(f"  new fitment rows:                  {len(payloads)}")
    print(f"  products touched:                  {len(by_itemid)}")
    print(f"  sources:                           {dict(source_counts)}")
    if by_itemid:
        print("  per itemid:")
        for itemid, count in sorted(by_itemid.items(), key=lambda pair: (-pair[1], pair[0])):
            print(f"    {itemid}: {count}")

    remaining = gap_itemids - set(by_itemid.keys())
    if remaining:
        print(f"  still without fitment rows: {len(remaining)}")
        for itemid in sorted(remaining):
            print(f"    {itemid}")

    if args.dry_run:
        print("\n[dry-run] Use --apply to insert rows.")
        return 0

    inserted, errors = insert_rows(payloads)
    print(f"\nInserted {inserted} rows ({errors} errors)")
    print("Next: python3 scripts/build-import-ready-matrixify.py --store-export ~/Downloads/Export_2026-06-24_160525.xlsx")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
