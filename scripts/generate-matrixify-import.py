#!/usr/bin/env python3
"""Generate Matrixify Enterprise product import from deduped itemid SSOT catalog.

One Shopify product row per supplier itemid (716 from TrackTech export CSV).
Merges MWE supplier TSV for cost, weight, and image URLs. Optional Supabase
catalog_images when credentials are available.

Usage:
  python3 scripts/generate-matrixify-import.py --dry-run
  python3 scripts/generate-matrixify-import.py --track-size 450x86x60
  python3 scripts/generate-matrixify-import.py --full
  python3 scripts/generate-matrixify-import.py --full --xlsx

Matrixify import (Heavy Iron Shopify):
  - Import mode: Update existing / Merge
  - Identify by: Variant SKU
  - Command column: MERGE
  - Tick: Products, Variants, Images, Metafields
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from lib.catalog_ssot import (  # noqa: E402
    CANONICAL_JSON,
    build_tracktech_data_api_json,
    canonical_product_handle,
    display_tread_pattern,
    is_attachment_itemid,
    is_excluded_catalog_itemid,
    iter_tracktech_export_rows,
    resolve_product_title,
    load_dotenv_fitment,
    load_catalog_image_maps,
    normalize_itemid,
    normalize_supplier_tread,
    parse_supplier_images,
    resolve_track_gallery_urls,
    resolve_tracktech_export,
    track_size_matches,
)

DEFAULT_SUPPLIER_TSV = ROOT / "data" / "mwe-supplier-catalog.tsv"
DEFAULT_OUTPUT = ROOT / "data" / "heavy-iron-matrixify-import.csv"
SAMPLE_OUTPUT = ROOT / "data" / "heavy-iron-matrixify-import-450x86x60.csv"
DEFAULT_SHOPIFY_CSV = Path.home() / "Desktop/SUPABASE/Products.csv"

SUPPLIER_COLUMNS = [
    "itemid", "shopify_sku", "brand", "product_name", "mpn", "cost", "col6",
    "qty_available", "in_stock", "track_pattern", "track_size", "width_mm",
    "pitch_mm", "links", "weight", "warranty", "warehouse_availability",
    "qty_pricing", "fitment_models", "image_urls", "catalog_brand", "pulled_at",
]

ROLE_ORDER = {"hero": 0, "tread_detail": 1, "alt": 2, "steel_cord": 3}

# Subset of TrackTech Matrixify export columns (Enterprise product import).
MATRIXIFY_COLUMNS = [
    "Handle",
    "Command",
    "Title",
    "Body HTML",
    "Vendor",
    "Type",
    "Tags",
    "Status",
    "Published",
    "Top Row",
    "Image Src",
    "Image Position",
    "Variant SKU",
    "Variant Price",
    "Variant Compare At Price",
    "Variant Cost",
    "Variant Weight",
    "Variant Weight Unit",
    "Variant Inventory Policy",
    "Variant Inventory Tracker",
    "Metafield: custom.tracktech_data_api [json]",
    "Metafield: custom.track_size [single_line_text_field]",
    "Metafield: custom.tread_pattern [single_line_text_field]",
    "Metafield: custom.mpn [single_line_text_field]",
    "Metafield: custom.width_mm [number_integer]",
    "Metafield: custom.pitch_mm [number_decimal]",
    "Metafield: custom.links [number_integer]",
]


def parse_weight_lbs(raw: str | None) -> float | None:
    if not raw:
        return None
    m = re.search(r"([\d.]+)", str(raw))
    return float(m.group(1)) if m else None


def product_type_for_row(row: dict) -> str:
    if row.get("spec_track_size"):
        return "track"
    itemid = str(row.get("itemid") or "").upper()
    if is_attachment_itemid(itemid):
        return "attachment"
    if itemid.startswith(("TNT", "BS", "SD", "ST")):
        return "track"
    if itemid.startswith("HT"):
        return "track"  # hybrid track assembly, not CID attachment
    return "uc_part"


def read_supplier_tsv(path: Path) -> dict[str, dict]:
    if not path.is_file():
        return {}
    grouped: dict[str, dict] = {}
    with path.open(newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=SUPPLIER_COLUMNS)
        header = next(reader, None)
        if header and header.get("itemid") != "itemid":
            row = _normalize_supplier_row(header)
            if row.get("itemid"):
                grouped[row["itemid"]] = row
        for raw in reader:
            if not any((raw.get(c) or "").strip() for c in SUPPLIER_COLUMNS[:2]):
                continue
            row = _normalize_supplier_row(raw)
            itemid = row.get("itemid")
            if not itemid:
                continue
            if itemid not in grouped:
                grouped[itemid] = row
            else:
                existing = grouped[itemid]
                if row.get("fitment_models") and len(str(row["fitment_models"])) > len(str(existing.get("fitment_models") or "")):
                    existing["fitment_models"] = row["fitment_models"]
                for field in ("cost", "weight", "image_urls", "product_name", "track_size", "track_pattern"):
                    if row.get(field) and not existing.get(field):
                        existing[field] = row[field]
    return grouped


def _normalize_supplier_row(raw: dict) -> dict:
    row: dict = {}
    for col in SUPPLIER_COLUMNS:
        val = (raw.get(col) or "").strip()
        row[col] = val or None
    return row


def load_canonical_index() -> dict[str, dict]:
    if not CANONICAL_JSON.is_file():
        return {}
    items = json.loads(CANONICAL_JSON.read_text(encoding="utf-8"))
    return {item["itemid"]: item for item in items if item.get("itemid")}


def parse_export_products(export_path: Path) -> dict[str, dict]:
    by_itemid: dict[str, dict] = {}
    for row in iter_tracktech_export_rows(export_path):
        raw_id = row.get("itemid")
        if not raw_id:
            continue
        itemid = str(raw_id).strip()
        if itemid in by_itemid:
            continue

        price_raw = row.get("onlinecustomerprice")
        price = None
        if price_raw is not None and str(price_raw).strip():
            try:
                price = round(float(price_raw), 2)
            except (TypeError, ValueError):
                pass

        width = row.get("spec_width_mm")
        pitch = row.get("spec_pitch")
        links = row.get("spec_links")
        track_size = row.get("spec_track_size")
        tread_raw = row.get("spec_track_pattern")

        by_itemid[itemid] = {
            "itemid": itemid,
            "title": str(row.get("product_name") or "").strip() or None,
            "mpn": str(row.get("mpn") or "").strip() or None,
            "price": price,
            "track_size": str(track_size).strip() if track_size else None,
            "tread_pattern": normalize_supplier_tread(str(tread_raw) if tread_raw else None),
            "width_mm": float(width) if width is not None and str(width).strip() else None,
            "pitch_mm": float(pitch) if pitch is not None and str(pitch).strip() else None,
            "links": int(float(links)) if links is not None and str(links).strip() else None,
            "fitment_models": str(row.get("fitment_models") or "").strip() or None,
            "type": product_type_for_row(row),
        }
    if not by_itemid:
        raise ValueError(f"Export missing itemid rows: {export_path}")
    for iid in [
        i
        for i in by_itemid
        if is_attachment_itemid(i)
        or is_excluded_catalog_itemid(i)
        or by_itemid[i].get("type") == "attachment"
    ]:
        del by_itemid[iid]
    return by_itemid


def clean_supplier_title(name: str | None) -> str | None:
    if not name:
        return None
    cleaned = name.strip().strip('"')
    cleaned = re.sub(r'^\d+(?:\.\d+)?"\s*', "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or None


def product_title(
    export: dict,
    supplier: dict | None,
    canonical: dict | None,
    *,
    supplier_title: bool = True,
) -> str:
    itemid = export["itemid"]
    product_name = (supplier or {}).get("product_name") or export.get("title")
    if export["type"] == "track":
        track_size = export.get("track_size") or (supplier or {}).get("track_size")
        tread = display_tread_pattern(export.get("tread_pattern")) or export.get("tread_pattern")
        width = export.get("width_mm") or (supplier or {}).get("width_mm")
        return resolve_product_title(
            itemid,
            product_name=export.get("title"),
            supplier_product_name=(supplier or {}).get("product_name"),
            track_size=track_size,
            tread_pattern=tread,
            width_mm=width,
            supplier_title=supplier_title,
            fallback=itemid,
        )
    name = clean_supplier_title(product_name)
    if name:
        return f"Heavy Duty Part | {itemid}" if itemid.upper() not in name.upper() else name
    return itemid


def product_handle(export: dict, canonical: dict | None) -> str:
    return canonical_product_handle(export["itemid"])


def product_tags(export: dict, supplier: dict | None) -> str:
    """Shopify allows max 250 tags per product. Fitments belong in custom.fitments (fitment sync), not Tags."""
    itemid = export["itemid"]
    tags = ["itemid-ssot", f"itemid:{itemid}"]
    if export["type"] == "track":
        tags.extend(["rubber-tracks", "nav:rubber-tracks"])
        track_size = export.get("track_size") or (supplier or {}).get("track_size")
        if track_size:
            tags.append(f"size:{track_size}")
    else:
        tags.append("undercarriage-parts")
    # Do NOT add fits:make-model tags — one itemid can have 400+ fitments (export rolls up all
    # machines), which exceeds Shopify's 250-tag limit. Use ./scripts/fitment sync instead.
    if len(tags) > 250:
        tags = tags[:250]
    return ", ".join(tags)


def build_description_html(export: dict, supplier: dict | None, title: str) -> str:
    if export["type"] != "track":
        name = clean_supplier_title((supplier or {}).get("product_name") or export.get("title")) or title
        itemid = export["itemid"]
        return (
            f"<p>{name}. OEM-cross-referenced undercarriage component with guaranteed fitment.</p>"
            f"<p>24-month manufacturer warranty where applicable. Free LTL freight to the contiguous US. "
            f"Same-day shipping on orders placed before 12&nbsp;PM&nbsp;CT.</p>"
            f"<ul><li><strong>SKU:</strong> {itemid}</li></ul>"
        )

    track_size = export.get("track_size") or (supplier or {}).get("track_size") or ""
    tread = display_tread_pattern(export.get("tread_pattern")) or export.get("tread_pattern") or ""
    itemid = export["itemid"]
    width = export.get("width_mm") or (supplier or {}).get("width_mm")
    pitch = export.get("pitch_mm") or (supplier or {}).get("pitch_mm")
    links = export.get("links") or (supplier or {}).get("links")
    weight = parse_weight_lbs((supplier or {}).get("weight"))

    parts = []
    if track_size:
        parts.append(f"sized <strong>{track_size}</strong>")
    dims = []
    if width:
        dims.append(f"{int(float(width))}&nbsp;mm width")
    if pitch:
        dims.append(f"{pitch}&nbsp;mm pitch")
    if links:
        dims.append(f"{int(float(links))} links")
    if dims:
        parts.append(f"({' &times; '.join(dims)})")

    lead = " ".join(parts).strip()
    if tread and lead:
        opener = f"<p>Heavy-duty {tread} rubber track {lead}."
    elif lead:
        opener = f"<p>OEM-spec rubber track {lead}."
    else:
        opener = "<p>OEM-spec rubber track built for demanding jobsite conditions."

    body = (
        f"{opener} Continuous steel cord construction, forged steel links, and an "
        "abrasion-resistant rubber compound deliver long service life with guaranteed fitment.</p>"
        "<p>24-month manufacturer warranty. Free LTL freight to the contiguous US. "
        "Same-day shipping on orders placed before 12&nbsp;PM&nbsp;CT.</p>"
    )
    bullets = []
    if tread:
        bullets.append(f"<li><strong>Pattern:</strong> {tread}</li>")
    if weight:
        w = int(weight) if weight == int(weight) else weight
        bullets.append(f"<li><strong>Weight:</strong> {w} lbs per track</li>")
    bullets.append(f"<li><strong>SKU:</strong> {itemid}</li>")
    return body + f"<ul>{''.join(bullets)}</ul>"


def gallery_urls(
    export: dict,
    supplier: dict | None,
    image_map: dict | None,
    itemid_image_map: dict | None = None,
) -> list[str]:
    if export["type"] == "track":
        track_size = export.get("track_size") or (supplier or {}).get("track_size")
        tread = export.get("tread_pattern") or normalize_supplier_tread((supplier or {}).get("track_pattern"))
        return resolve_track_gallery_urls(
            export["itemid"],
            track_size,
            tread,
            image_map=image_map,
            itemid_image_map=itemid_image_map,
        )
    urls: list[str] = []
    for u in parse_supplier_images((supplier or {}).get("image_urls")):
        if u not in urls:
            urls.append(u)
    return urls[:10]


def shopify_product_type(export: dict) -> str:
    return "Rubber Tracks" if export["type"] == "track" else "Undercarriage Parts"


def build_product_record(
    export: dict,
    supplier: dict | None,
    canonical: dict | None,
    image_map: dict | None,
    itemid_image_map: dict | None = None,
    *,
    command: str = "MERGE",
    supplier_title: bool = True,
) -> dict:
    itemid = export["itemid"]
    sup = supplier or {}
    title = product_title(export, sup, canonical, supplier_title=supplier_title)
    handle = product_handle(export, canonical)
    tread = display_tread_pattern(export.get("tread_pattern")) or export.get("tread_pattern")
    track_size = export.get("track_size") or sup.get("track_size")
    cost = sup.get("cost")
    try:
        cost_f = round(float(cost), 2) if cost is not None else None
    except (TypeError, ValueError):
        cost_f = None
    price = export.get("price")
    if price is None and cost_f is not None:
        price = round(cost_f * 1.28, 2)
    weight = parse_weight_lbs(sup.get("weight"))
    width = export.get("width_mm")
    if width is None and sup.get("width_mm"):
        try:
            width = int(float(sup["width_mm"]))
        except (TypeError, ValueError):
            width = None
    pitch = export.get("pitch_mm")
    if pitch is None and sup.get("pitch_mm"):
        try:
            pitch = float(sup["pitch_mm"])
        except (TypeError, ValueError):
            pitch = None
    links = export.get("links")
    if links is None and sup.get("links"):
        try:
            links = int(float(sup["links"]))
        except (TypeError, ValueError):
            links = None
    mpn = export.get("mpn") or sup.get("mpn") or itemid

    return {
        "handle": handle,
        "command": command,
        "title": title,
        "body_html": build_description_html(export, sup, title),
        "vendor": "Heavy Iron Supply Co",
        "type": shopify_product_type(export),
        "tags": product_tags(export, sup),
        "status": "Active",
        "published": "TRUE",
        "variant_sku": itemid,
        "variant_price": f"{price:.2f}" if price is not None else "",
        "variant_cost": f"{cost_f:.2f}" if cost_f is not None else "",
        "variant_weight": str(int(weight)) if weight is not None and weight == int(weight) else (str(weight) if weight else ""),
        "variant_weight_unit": "lb" if weight else "",
        "images": gallery_urls(export, sup, image_map, itemid_image_map),
        "metafields": {
            "tracktech_data_api": itemid,
            "track_size": track_size or "",
            "tread_pattern": tread or "",
            "mpn": mpn,
            "width_mm": str(int(width)) if width is not None else "",
            "pitch_mm": str(pitch) if pitch is not None else "",
            "links": str(int(links)) if links is not None else "",
        },
    }


def matrixify_rows(product: dict) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    images = product["images"] or [""]
    mf = product["metafields"]

    for idx, image_src in enumerate(images):
        row = {col: "" for col in MATRIXIFY_COLUMNS}
        row["Handle"] = product["handle"]
        row["Command"] = product["command"] if idx == 0 else ""
        if idx == 0:
            row["Title"] = product["title"]
            row["Body HTML"] = product["body_html"]
            row["Vendor"] = product["vendor"]
            row["Type"] = product["type"]
            row["Tags"] = product["tags"]
            row["Status"] = product["status"]
            row["Published"] = product["published"]
            row["Top Row"] = "TRUE"
            row["Variant SKU"] = product["variant_sku"]
            row["Variant Price"] = product["variant_price"]
            row["Variant Cost"] = product["variant_cost"]
            row["Variant Weight"] = product["variant_weight"]
            row["Variant Weight Unit"] = product["variant_weight_unit"]
            row["Variant Inventory Policy"] = "continue"
            row["Variant Inventory Tracker"] = ""
            row["Metafield: custom.tracktech_data_api [json]"] = build_tracktech_data_api_json(mf["tracktech_data_api"])
            row["Metafield: custom.track_size [single_line_text_field]"] = mf["track_size"]
            row["Metafield: custom.tread_pattern [single_line_text_field]"] = mf["tread_pattern"]
            row["Metafield: custom.mpn [single_line_text_field]"] = mf["mpn"]
            row["Metafield: custom.width_mm [number_integer]"] = mf["width_mm"]
            row["Metafield: custom.pitch_mm [number_decimal]"] = mf["pitch_mm"]
            row["Metafield: custom.links [number_integer]"] = mf["links"]
        else:
            row["Top Row"] = ""
        if image_src:
            row["Image Src"] = image_src
            row["Image Position"] = str(idx + 1)
        rows.append(row)
    return rows


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=MATRIXIFY_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_xlsx(path: Path, rows: list[dict[str, str]]) -> None:
    import openpyxl

    path.parent.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Products"
    ws.append(MATRIXIFY_COLUMNS)
    for row in rows:
        ws.append([row.get(col, "") for col in MATRIXIFY_COLUMNS])
    wb.save(path)


def optional_image_maps() -> tuple[dict | None, dict | None]:
    try:
        from lib.catalog_ssot import load_catalog_image_maps, supabase_key

        load_dotenv_fitment()
        if supabase_key():
            return load_catalog_image_maps()
    except Exception:
        pass
    return None, None


def load_shopify_export_itemids(path: Path) -> set[str]:
    """Itemids already in Shopify Matrixify export (Products.csv)."""
    ids: set[str] = set()
    if not path.is_file():
        return ids
    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            iid = ""
            for k, v in row.items():
                if "tracktech_itemid" in k.lower() and (v or "").strip():
                    iid = v.strip().upper()
                    break
            if not iid:
                iid = (row.get("Variant SKU") or "").strip().upper()
            if iid:
                ids.add(iid)
    return ids


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Matrixify Enterprise product import CSV")
    parser.add_argument("--export", type=Path, default=None, help="TrackTech CSV/xlsx export")
    parser.add_argument("--supplier-tsv", type=Path, default=DEFAULT_SUPPLIER_TSV)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--full", action="store_true", help="All 716 itemids (default: 450x86x60 sample)")
    parser.add_argument("--track-size", help="Filter by track size (e.g. 450x86x60)")
    parser.add_argument("--itemid", action="append", help="Include specific itemid (repeatable)")
    parser.add_argument(
        "--missing-from-csv",
        type=Path,
        default=None,
        help="Only itemids in TrackTech export but not in this Shopify export (delta import)",
    )
    parser.add_argument("--command", default="MERGE", choices=["MERGE", "NEW", "UPDATE"])
    parser.add_argument("--xlsx", action="store_true", help="Also write .xlsx alongside CSV")
    parser.add_argument("--dry-run", action="store_true", help="Print summary only")
    parser.add_argument(
        "--supplier-title",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Use supplier/export product_name as Title (default). Use --no-supplier-title for HI format.",
    )
    args = parser.parse_args()

    export_path = resolve_tracktech_export(args.export)
    if not export_path.is_file():
        print(f"Export not found: {export_path}", file=sys.stderr)
        return 1

    by_itemid = parse_export_products(export_path)
    supplier_map = read_supplier_tsv(args.supplier_tsv)
    canonical_map = load_canonical_index()
    image_map, itemid_image_map = optional_image_maps()

    if args.itemid:
        wanted = {i.strip() for i in args.itemid}
        by_itemid = {k: v for k, v in by_itemid.items() if k in wanted}
    elif args.missing_from_csv:
        have = load_shopify_export_itemids(args.missing_from_csv)
        missing = {k for k in by_itemid if k.upper() not in have}
        by_itemid = {k: v for k, v in by_itemid.items() if k in missing}
        print(f"  delta filter: {len(missing)} itemids not in {args.missing_from_csv.name}")
    elif args.track_size:
        by_itemid = {
            iid: row
            for iid, row in by_itemid.items()
            if track_size_matches(args.track_size, row.get("track_size"))
        }
    elif not args.full:
        by_itemid = {
            iid: row
            for iid, row in by_itemid.items()
            if track_size_matches("450x86x60", row.get("track_size"))
        }

    if not by_itemid:
        print("No products matched filters", file=sys.stderr)
        return 1

    products: list[dict] = []
    skipped_no_price: list[str] = []
    with_supplier = with_images = 0
    for itemid in sorted(by_itemid):
        export = by_itemid[itemid]
        sup = supplier_map.get(itemid)
        if sup and (sup.get("cost") or sup.get("weight") or sup.get("image_urls")):
            with_supplier += 1
        canonical = canonical_map.get(itemid)
        product = build_product_record(
            export, sup, canonical, image_map, itemid_image_map,
            command=args.command, supplier_title=args.supplier_title,
        )
        if not product.get("variant_price"):
            skipped_no_price.append(itemid)
            continue
        if product["images"]:
            with_images += 1
        products.append(product)

    if skipped_no_price:
        print(f"  skipped no price: {len(skipped_no_price)} ({', '.join(skipped_no_price[:5])}{'…' if len(skipped_no_price) > 5 else ''})")

    matrixify: list[dict[str, str]] = []
    for product in products:
        matrixify.extend(matrixify_rows(product))

    if args.full:
        out_csv = args.output or DEFAULT_OUTPUT
    elif args.track_size or args.itemid or args.missing_from_csv:
        slug = (args.track_size or ("delta" if args.missing_from_csv else "custom")).replace("/", "-").replace(" ", "")
        out_csv = args.output or ROOT / "data" / f"heavy-iron-matrixify-import-{slug}.csv"
    else:
        out_csv = args.output or SAMPLE_OUTPUT

    print("=== Matrixify Enterprise import ===")
    print("  attachments:        excluded (separate CID catalog)")
    print("  OTT/tires/wheels:   excluded (not carried on Heavy Iron)")
    print(f"  export:           {export_path.name}")
    print(f"  supplier TSV:     {args.supplier_tsv.name} ({len(supplier_map)} itemids)")
    print(f"  products:         {len(products)}")
    print(f"  matrixify rows:   {len(matrixify)} (incl. extra image rows)")
    print(f"  with supplier:    {with_supplier}")
    print(f"  with images:      {with_images}")
    print(f"  command:          {args.command}")
    print(f"  output:           {out_csv}")
    if products:
        for sample in products[:2]:
            print(f"  sample product:   {sample['handle']} | SKU {sample['variant_sku']} | {sample['title'][:72]}")

    if args.dry_run:
        print("\n[dry-run] No file written.")
        return 0

    write_csv(out_csv, matrixify)
    print(f"\nWrote {len(matrixify)} rows → {out_csv}")
    if args.xlsx:
        out_xlsx = out_csv.with_suffix(".xlsx")
        write_xlsx(out_xlsx, matrixify)
        print(f"Wrote {len(matrixify)} rows → {out_xlsx}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
