"""Model metaobject publish contract — dev fleet_* views → Matrixify workbooks."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CANONICAL_HANDLES = ROOT / "data" / "shopify-canonical-handles.json"

TIER_ORDER = {"TNT": 0, "BS": 1, "TT": 2}
TREAD_ORDER = ["C-Block", "Zig-Zag", "Multi-Bar", "X-Terrain", "Staggered Block", "Z-Max", "Directional", "MX"]
OPTION_LABEL_ORDER = {"wide": 0, "standard": 1, "alternate": 2, "narrow": 3}


@dataclass
class ModelMetaobjectRow:
    machine_id: str
    shopify_handle: str
    brand: str
    model: str
    machine_type: str
    primary_track_size: str
    primary_track_size_id: str
    hero_url: str | None
    track_product_handles: list[str] = field(default_factory=list)
    uc_product_handles: list[str] = field(default_factory=list)
    approved_track_sizes: list[str] = field(default_factory=list)
    publish_status: str = "ready"
    blockers: list[str] = field(default_factory=list)


@dataclass
class TrackVariantRow:
    shopify_handle: str
    machine_id: str
    sku: str
    product_handle: str
    product_track_size: str
    option_label: str
    size_display_priority: int
    pattern: str
    product_tier: str
    sort_rank: int
    wide_before_narrow_rank: int


@dataclass
class ModelMediaRow:
    shopify_handle: str
    machine_id: str
    media_type: str
    entity_id: str
    url: str
    role: str
    alt_text: str
    source_system: str


def load_canonical_handles() -> dict[str, str]:
    if not CANONICAL_HANDLES.is_file():
        return {}
    data = json.loads(CANONICAL_HANDLES.read_text(encoding="utf-8"))
    return {
        iid.upper(): (info.get("handle") or "").strip()
        for iid, info in (data.get("itemids") or {}).items()
        if info.get("handle")
    }


def sku_to_handle(sku: str, canonical: dict[str, str]) -> str | None:
    key = (sku or "").strip().upper()
    if not key:
        return None
    return canonical.get(key) or key.lower()


def product_tier(sku: str) -> str:
    u = (sku or "").upper()
    if u.startswith("TNT"):
        return "TNT"
    if u.startswith("BS"):
        return "BS"
    if u.startswith("TT"):
        return "TT"
    return "OTHER"


def tier_rank(sku: str) -> int:
    return TIER_ORDER.get(product_tier(sku), 9)


def tread_rank(pattern: str) -> int:
    p = (pattern or "").strip()
    for i, label in enumerate(TREAD_ORDER):
        if label.lower() in p.lower() or p.lower() in label.lower():
            return i
    return len(TREAD_ORDER)


def is_v2_track_row(product_type: str, product_track_size: str | None, product_track_size_id: str | None) -> bool:
    ptype = (product_type or "")
    if "Track" not in ptype and ptype != "Track Pads":
        return True
    size = (product_track_size or "").strip()
    if not size or not product_track_size_id:
        return False
    if re.search(r"rubbertrack", size, re.I):
        return False
    chunks = [c for c in size.lower().split("x") if c]
    return 0 < len(chunks) <= 3


def product_bucket(sku: str, product_type: str, fitment_type: str) -> str:
    code = (sku or "").upper()
    ptype = (product_type or "").lower()
    ftype = (fitment_type or "").lower()
    if ftype == "track" or code.startswith("TNT") or code.startswith("BS"):
        return "track"
    if "track" in ptype and "undercarriage" not in ptype:
        return "track"
    if "undercarriage" in ptype or ptype in ("undercarriage part", "undercarriage"):
        return "uc"
    return "uc"


def fetch_contract(conn) -> tuple[list[ModelMetaobjectRow], list[TrackVariantRow], list[ModelMediaRow]]:
    canonical_handles = load_canonical_handles()

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              c.machine_id,
              c.shopify_handle,
              c.brand,
              c.model,
              COALESCE(c.machine_type, ''),
              COALESCE(vts.canonical_size, ''),
              COALESCE(c.track_size_id, ''),
              c.horsepower,
              c.operating_weight_lbs
            FROM fleet_machine_catalog c
            LEFT JOIN core.v_track_size_v2 vts ON vts.track_size_id = c.track_size_id
            WHERE COALESCE(c.shopify_handle, '') <> ''
            ORDER BY c.brand, c.model
            """
        )
        machines = cur.fetchall()

        cur.execute(
            """
            SELECT machine_id, canonical_size, option_label, display_priority, track_size_id
            FROM fleet_machine_track_size_options
            ORDER BY machine_id, display_priority, canonical_size
            """
        )
        size_options = cur.fetchall()

        cur.execute(
            """
            SELECT
              machine_id, sku, product_type, fitment_type, pattern,
              product_track_size, product_track_size_id, machine_track_size
            FROM fleet_qa_parts
            WHERE sku IS NOT NULL
            """
        )
        parts = cur.fetchall()

        cur.execute(
            """
            SELECT machine_id, url, alt_text, media_id
            FROM fleet_model_hero
            WHERE url IS NOT NULL AND url <> ''
            """
        )
        heroes = {r[0]: {"url": r[1], "alt": r[2] or "", "media_id": r[3]} for r in cur.fetchall()}

        cur.execute(
            """
            SELECT track_size_id, url, role, tread_pattern, alt_text, media_id
            FROM fleet_track_size_media
            WHERE url IS NOT NULL AND url <> ''
            """
        )
        track_media = cur.fetchall()

        cur.execute(
            """
            SELECT sku, url, role, alt_text, media_id
            FROM fleet_product_media
            WHERE url IS NOT NULL AND url <> ''
            """
        )
        product_media = cur.fetchall()

    models: dict[str, ModelMetaobjectRow] = {}
    for mid, handle, brand, model, mtype, pts, pts_id, *_rest in machines:
        hero = heroes.get(mid)
        models[mid] = ModelMetaobjectRow(
            machine_id=mid,
            shopify_handle=(handle or "").strip(),
            brand=brand or "",
            model=model or "",
            machine_type=mtype or "",
            primary_track_size=pts or "",
            primary_track_size_id=pts_id or "",
            hero_url=hero["url"] if hero else None,
        )

    size_by_machine: dict[str, list[tuple]] = defaultdict(list)
    size_label_by_machine_size: dict[tuple[str, str], tuple[str, int]] = {}
    for mid, canonical, label, dpriority, ts_id in size_options:
        if mid in models:
            size_by_machine[mid].append(canonical)
            size_label_by_machine_size[(mid, canonical)] = (label or "standard", int(dpriority or 99))

    track_variants: list[TrackVariantRow] = []
    track_by_machine: dict[str, list[tuple[str, int, int, int]]] = defaultdict(list)
    uc_by_machine: dict[str, set[str]] = defaultdict(set)

    seen_track: set[tuple[str, str]] = set()

    for machine_id, sku, ptype, ftype, pattern, pts, pts_id, mts in parts:
        if machine_id not in models:
            continue
        if not is_v2_track_row(ptype or "", pts, pts_id):
            continue
        ph = sku_to_handle(sku, canonical_handles)
        if not ph:
            continue
        bucket = product_bucket(sku, ptype or "", ftype or "")
        model_row = models[machine_id]

        if bucket == "track":
            track_size = pts or mts or model_row.primary_track_size
            opt_label, size_dp = size_label_by_machine_size.get(
                (machine_id, track_size), ("standard", 1)
            )
            wide_rank = OPTION_LABEL_ORDER.get(opt_label, 2)
            sort_key = (
                wide_rank,
                tier_rank(sku),
                tread_rank(pattern or ""),
                track_size,
                sku,
            )
            track_by_machine[machine_id].append((ph, *sort_key))
            key = (machine_id, ph)
            if key not in seen_track:
                seen_track.add(key)
                track_variants.append(
                    TrackVariantRow(
                        shopify_handle=model_row.shopify_handle,
                        machine_id=machine_id,
                        sku=sku,
                        product_handle=ph,
                        product_track_size=track_size or "",
                        option_label=opt_label,
                        size_display_priority=size_dp,
                        pattern=pattern or "",
                        product_tier=product_tier(sku),
                        sort_rank=0,
                        wide_before_narrow_rank=wide_rank,
                    )
                )
        else:
            uc_by_machine[machine_id].add(ph)

    for mid, model_row in models.items():
        model_row.approved_track_sizes = size_by_machine.get(mid, [])
        tracks = track_by_machine.get(mid, [])
        tracks.sort(key=lambda t: (t[1], t[2], t[3], t[4], t[5]))
        model_row.track_product_handles = [t[0] for t in tracks]
        model_row.uc_product_handles = sorted(uc_by_machine.get(mid, set()))

        rank = 0
        for tv in track_variants:
            if tv.machine_id == mid:
                rank += 1
                tv.sort_rank = rank

        if not model_row.primary_track_size:
            model_row.blockers.append("missing_primary_track_size_v2")
        if not model_row.track_product_handles and not model_row.uc_product_handles:
            model_row.blockers.append("no_products")
            model_row.publish_status = "blocked"
        elif model_row.blockers:
            model_row.publish_status = "partial"
        else:
            model_row.publish_status = "ready"

    media_rows: list[ModelMediaRow] = []
    for mid, model_row in models.items():
        hero = heroes.get(mid)
        if hero:
            media_rows.append(
                ModelMediaRow(
                    shopify_handle=model_row.shopify_handle,
                    machine_id=mid,
                    media_type="machine_hero",
                    entity_id=mid,
                    url=hero["url"],
                    role="hero",
                    alt_text=hero.get("alt") or f"{model_row.brand} {model_row.model}",
                    source_system="fleet_model_hero",
                )
            )

    machine_track_sizes: dict[str, set[str]] = defaultdict(set)
    for mid, canonical, *_ in size_options:
        if mid in models:
            machine_track_sizes[mid].add(canonical)

    ts_to_canonical: dict[str, str] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT track_size_id, canonical_size FROM core.v_track_size_v2")
        ts_to_canonical = {r[0]: r[1] for r in cur.fetchall()}

    for ts_id, url, role, tread, alt, _media_id in track_media:
        canonical = ts_to_canonical.get(ts_id, ts_id)
        for mid, sizes in machine_track_sizes.items():
            if canonical not in sizes:
                continue
            m = models[mid]
            media_rows.append(
                ModelMediaRow(
                    shopify_handle=m.shopify_handle,
                    machine_id=mid,
                    media_type="track_size",
                    entity_id=ts_id,
                    url=url,
                    role=role or "gallery",
                    alt_text=alt or f"{canonical} {tread or ''}".strip(),
                    source_system="fleet_track_size_media",
                )
            )

    sku_to_machines: dict[str, set[str]] = defaultdict(set)
    for machine_id, sku, ptype, ftype, *_rest in parts:
        if machine_id in models and product_bucket(sku, ptype or "", ftype or "") == "track":
            sku_to_machines[(sku or "").upper()].add(machine_id)

    for sku, url, role, alt, _media_id in product_media:
        for mid in sku_to_machines.get((sku or "").upper(), set()):
            m = models[mid]
            media_rows.append(
                ModelMediaRow(
                    shopify_handle=m.shopify_handle,
                    machine_id=mid,
                    media_type="product",
                    entity_id=sku,
                    url=url,
                    role=role or "primary",
                    alt_text=alt or sku,
                    source_system="fleet_product_media",
                )
            )

    track_variants.sort(key=lambda v: (v.shopify_handle, v.sort_rank, v.sku))

    return list(models.values()), track_variants, media_rows


def write_workbook(path: Path, sheet_name: str, headers: list[str], rows: list[list[Any]]) -> None:
    import openpyxl

    path.parent.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name[:31]
    ws.append(headers)
    for row in rows:
        ws.append(row)
    wb.save(path)


def export_matrixify_workbooks(
    out_dir: Path,
    models: list[ModelMetaobjectRow],
    variants: list[TrackVariantRow],
    media: list[ModelMediaRow],
) -> dict[str, int]:
    publishable = [m for m in models if m.publish_status != "blocked"]

    meta_headers = [
        "Handle",
        "Command",
        "Field: display_name",
        "Field: primary_track_size",
        "Field: hero_image",
        "Field: track_products [list.product_reference]",
        "Field: uc_products [list.product_reference]",
        "machine_id",
        "publish_status",
        "Field: approved_track_sizes [single_line_text_field]",
    ]
    meta_rows = []
    for m in publishable:
        if not m.track_product_handles and not m.hero_url and not m.primary_track_size:
            continue
        meta_rows.append(
            [
                m.shopify_handle,
                "MERGE",
                f"{m.brand} {m.model}".strip(),
                m.primary_track_size,
                m.hero_url or "",
                ", ".join(m.track_product_handles),
                ", ".join(m.uc_product_handles),
                m.machine_id,
                m.publish_status,
                ", ".join(m.approved_track_sizes),
            ]
        )

    variant_headers = [
        "Model Handle",
        "machine_id",
        "sort_rank",
        "wide_before_narrow_rank",
        "option_label",
        "size_display_priority",
        "product_tier",
        "SKU",
        "Product Handle",
        "product_track_size",
        "pattern",
        "Command",
    ]
    variant_rows = [
        [
            v.shopify_handle,
            v.machine_id,
            v.sort_rank,
            v.wide_before_narrow_rank,
            v.option_label,
            v.size_display_priority,
            v.product_tier,
            v.sku,
            v.product_handle,
            v.product_track_size,
            v.pattern,
            "MERGE",
        ]
        for v in variants
        if v.shopify_handle in {m.shopify_handle for m in publishable}
    ]

    media_headers = [
        "Model Handle",
        "machine_id",
        "media_type",
        "entity_id",
        "role",
        "url",
        "alt_text",
        "source_system",
    ]
    media_rows = [
        [
            r.shopify_handle,
            r.machine_id,
            r.media_type,
            r.entity_id,
            r.role,
            r.url,
            r.alt_text,
            r.source_system,
        ]
        for r in media
        if r.shopify_handle in {m.shopify_handle for m in publishable}
    ]

    write_workbook(out_dir / "model_metaobjects_matrixify.xlsx", "Models", meta_headers, meta_rows)
    write_workbook(out_dir / "model_track_variants_matrixify.xlsx", "TrackVariants", variant_headers, variant_rows)
    write_workbook(out_dir / "model_media_matrixify.xlsx", "Media", media_headers, media_rows)

    return {
        "models": len(meta_rows),
        "variants": len(variant_rows),
        "media": len(media_rows),
        "blocked": sum(1 for m in models if m.publish_status == "blocked"),
    }
