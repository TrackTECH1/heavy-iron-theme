#!/usr/bin/env python3
"""P0: Fill missing Image Src on heavy-iron-matrixify-import.csv for audit pass.

Sources (in order): existing row, Products.csv SKU match, HI catalog/master galleries,
size-only master fallback for tracks, supplier image_urls for UC.
"""
from __future__ import annotations

import csv
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

CSV_PATH = ROOT / "data" / "heavy-iron-matrixify-import.csv"
BUNDLE_CSV = ROOT / "MATRIXIFY_IMPORT_FILES" / "products" / "products_matrixify.csv"
PRODUCTS_EXPORT = Path.home() / "Desktop/SUPABASE/Products.csv"
SUPPLIER_TSV = ROOT / "data" / "imports" / "mwe-supplier-catalog.tsv"


def load_shop_images() -> dict[str, str]:
    out: dict[str, str] = {}
    if not PRODUCTS_EXPORT.is_file():
        return out
    with PRODUCTS_EXPORT.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sku = (row.get("Variant SKU") or "").strip().upper()
            img = (row.get("Image Src") or "").strip()
            if sku and img:
                out[sku] = img
    return out


def tread_from_handle(handle: str, title: str) -> str:
    blob = f"{handle} {title}".lower()
    for label, slugs in {
        "C-Block": ("c-block", "cblock", "cxd"),
        "MX": ("mx",),
        "Multi-Bar": ("multi-bar", "mbar"),
        "Zig-Zag": ("zig-zag", "zzag"),
        "X-Terrain": ("x-terrain", "xterrain"),
        "Staggered Block": ("staggered-block", "sblock"),
        "Directional": ("directional",),
    }.items():
        if any(s in blob for s in slugs):
            return label
    return ""


def any_size_image(image_map: dict, track_size: str | None) -> list[str]:
    from lib.catalog_ssot import track_size_image_variants, urls_from_catalog_image_rows

    for ts in track_size_image_variants(track_size):
        for (size, _tread), rows in image_map.items():
            if size == ts and rows:
                return urls_from_catalog_image_rows(rows)
    return []


def width_prefix(track_size: str | None) -> str:
    if not track_size:
        return ""
    part = track_size.lower().split("x", 1)[0]
    digits = "".join(c for c in part if c.isdigit())
    return digits


def family_image(by_sku_row: dict[str, dict], track_size: str | None, ptype: str) -> str:
    prefix = width_prefix(track_size)
    if not prefix:
        return ""
    for row in by_sku_row.values():
        if (row.get("Type") or "").strip().lower() != ptype:
            continue
        if not (row.get("Image Src") or "").strip():
            continue
        other_ts = (row.get("Metafield: custom.track_size [single_line_text_field]") or "").strip()
        if width_prefix(other_ts) == prefix:
            return row["Image Src"]
    return ""


def master_size_fallback(master: dict[str, list[str]], track_size: str | None) -> list[str]:
    from lib.catalog_ssot import normalize_track_size_for_images, track_size_image_variants

    for ts in track_size_image_variants(track_size):
        norm = normalize_track_size_for_images(ts) or ts
        for key, urls in master.items():
            if key.startswith(f"{norm}|") and urls:
                return urls
    return []


def main() -> int:
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "generate_matrixify_import", ROOT / "scripts" / "generate-matrixify-import.py"
    )
    if spec is None or spec.loader is None:
        raise ImportError("generate-matrixify-import.py")
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    read_supplier_tsv = gen.read_supplier_tsv
    from lib.catalog_ssot import (
        load_catalog_image_maps,
        load_dotenv_fitment,
        load_hi_master_track_images,
        parse_supplier_images,
        resolve_track_gallery_urls,
    )

    load_dotenv_fitment()
    if not CSV_PATH.is_file():
        print(f"Missing {CSV_PATH}", file=sys.stderr)
        return 1

    shop_imgs = load_shop_images()
    supplier = read_supplier_tsv(SUPPLIER_TSV)
    image_map, itemid_image_map = load_catalog_image_maps()
    master = load_hi_master_track_images()

    rows: list[dict[str, str]] = []
    with CSV_PATH.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        for row in reader:
            rows.append(dict(row))

    by_handle: dict[str, dict[str, str]] = {}
    for row in rows:
        handle = (row.get("Handle") or "").strip()
        if handle:
            by_handle[handle] = row

    filled = 0
    tread_fixed = 0
    for row in rows:
        handle = (row.get("Handle") or "").strip()
        title = (row.get("Title") or "").strip()
        ptype = (row.get("Type") or "").strip().lower()
        tread = (row.get("Metafield: custom.tread_pattern [single_line_text_field]") or "").strip()
        if not tread and "track" in ptype and "undercarriage" not in ptype:
            inferred = tread_from_handle(handle, title)
            if inferred:
                row["Metafield: custom.tread_pattern [single_line_text_field]"] = inferred
                tread = inferred
                tread_fixed += 1

        if (row.get("Image Src") or "").strip():
            continue
        sku = (row.get("Variant SKU") or "").strip().upper()
        ts = (row.get("Metafield: custom.track_size [single_line_text_field]") or "").strip()
        if not tread:
            tread = (row.get("Metafield: custom.tread_pattern [single_line_text_field]") or "").strip()
        urls: list[str] = []

        if sku and sku in shop_imgs:
            urls = [shop_imgs[sku]]
        elif "track" in ptype and "undercarriage" not in ptype:
            urls = resolve_track_gallery_urls(
                sku, ts, tread, image_map=image_map, itemid_image_map=itemid_image_map
            )
            if not urls:
                urls = master_size_fallback(master, ts)
            if not urls:
                urls = any_size_image(image_map, ts)
            if not urls:
                family = family_image(by_handle, ts, ptype)
                if family:
                    urls = [family]
        else:
            sup = supplier.get(sku) or {}
            urls = parse_supplier_images(sup.get("image_urls"))

        if urls:
            row["Image Src"] = urls[0]
            filled += 1

    with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    if BUNDLE_CSV.parent.is_dir():
        shutil.copy2(CSV_PATH, BUNDLE_CSV)

    print(f"Filled Image Src on {filled} matrixify rows; inferred tread on {tread_fixed} → {CSV_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
