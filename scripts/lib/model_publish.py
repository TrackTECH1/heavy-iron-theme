"""Build Model metaobject publish rows from My Fleet / dev clean Supabase views."""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CANONICAL_HANDLES = ROOT / "data" / "shopify-canonical-handles.json"


@dataclass
class ModelPublishRow:
    machine_id: str
    shopify_handle: str
    brand: str
    model: str
    primary_track_size: str
    hero_url: str | None
    track_product_handles: list[str] = field(default_factory=list)
    uc_product_handles: list[str] = field(default_factory=list)
    status: str = "ready"
    notes: list[str] = field(default_factory=list)


def load_canonical_handles() -> dict[str, str]:
    """SKU/itemid (upper) → Shopify product handle."""
    if not CANONICAL_HANDLES.is_file():
        return {}
    data = json.loads(CANONICAL_HANDLES.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for iid, info in (data.get("itemids") or {}).items():
        h = (info.get("handle") or "").strip()
        if h:
            out[iid.upper()] = h
    return out


def sku_to_handle(sku: str, canonical: dict[str, str]) -> str | None:
    key = (sku or "").strip().upper()
    if not key:
        return None
    if key in canonical:
        return canonical[key]
    return key.lower()


def product_bucket(sku: str, product_type: str, fitment_type: str) -> str:
    code = (sku or "").upper()
    ptype = (product_type or "").lower()
    ftype = (fitment_type or "").lower()
    if ftype == "track" or code.startswith("TNT") or code.startswith("BS"):
        return "track"
    if "track" in ptype and "undercarriage" not in ptype:
        return "track"
    if "undercarriage" in ptype or code.startswith(("SPK", "IDL", "ROL", "UC")):
        return "uc"
    if ptype in ("undercarriage part", "undercarriage"):
        return "uc"
    return "uc"


def fetch_publish_rows(conn) -> list[ModelPublishRow]:
    canonical = load_canonical_handles()

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              mo.machine_id,
              mo.shopify_handle,
              ma.brand,
              mo.model,
              ts.canonical_size AS primary_track_size
            FROM core.model mo
            JOIN core.make ma ON ma.brand_id = mo.brand_id
            LEFT JOIN core.v_track_size_v2 ts ON ts.track_size_id = mo.primary_track_size_id
            WHERE mo.machine_status = 'active_v1'
              AND COALESCE(mo.shopify_handle, '') <> ''
            ORDER BY ma.brand, mo.model
            """
        )
        machines = cur.fetchall()

        cur.execute(
            """
            SELECT machine_id, url
            FROM fleet_model_hero
            WHERE url IS NOT NULL AND url <> ''
            """
        )
        heroes = {r[0]: r[1] for r in cur.fetchall()}

        cur.execute(
            """
            SELECT
              machine_id,
              sku,
              product_type,
              fitment_type
            FROM fleet_qa_parts
            WHERE sku IS NOT NULL
            """
        )
        parts = cur.fetchall()

    by_machine: dict[str, ModelPublishRow] = {}
    for mid, handle, brand, model, pts in machines:
        by_machine[mid] = ModelPublishRow(
            machine_id=mid,
            shopify_handle=(handle or "").strip(),
            brand=brand or "",
            model=model or "",
            primary_track_size=pts or "",
            hero_url=heroes.get(mid),
        )

    track_sets: dict[str, set[str]] = defaultdict(set)
    uc_sets: dict[str, set[str]] = defaultdict(set)

    for machine_id, sku, product_type, fitment_type in parts:
        if machine_id not in by_machine:
            continue
        ph = sku_to_handle(sku, canonical)
        if not ph:
            continue
        bucket = product_bucket(sku, product_type or "", fitment_type or "")
        if bucket == "track":
            track_sets[machine_id].add(ph)
        else:
            uc_sets[machine_id].add(ph)

    rows: list[ModelPublishRow] = []
    for mid, row in by_machine.items():
        row.track_product_handles = sorted(track_sets.get(mid, set()))
        row.uc_product_handles = sorted(uc_sets.get(mid, set()))
        if not row.hero_url:
            row.notes.append("missing_hero")
        if not row.primary_track_size:
            row.notes.append("missing_primary_track_size")
        if not row.track_product_handles and not row.uc_product_handles:
            row.notes.append("no_products")
            row.status = "review"
        elif row.notes:
            row.status = "partial"
        rows.append(row)

    return rows


def write_matrixify_csv(path: Path, rows: list[ModelPublishRow]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    headers = [
        "Handle",
        "Command",
        "Field: primary_track_size",
        "Field: hero_image",
        "Field: track_products [list.product_reference]",
        "Field: uc_products [list.product_reference]",
    ]
    count = 0
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(headers)
        for row in rows:
            if row.status == "review" and not row.hero_url and not row.track_product_handles:
                continue
            w.writerow(
                [
                    row.shopify_handle,
                    "MERGE",
                    row.primary_track_size,
                    row.hero_url or "",
                    ", ".join(row.track_product_handles),
                    ", ".join(row.uc_product_handles),
                ]
            )
            count += 1
    return count


def write_report_csv(path: Path, rows: list[ModelPublishRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "machine_id",
                "shopify_handle",
                "brand",
                "model",
                "status",
                "primary_track_size",
                "hero_url",
                "track_count",
                "uc_count",
                "notes",
            ],
        )
        w.writeheader()
        for row in rows:
            w.writerow(
                {
                    "machine_id": row.machine_id,
                    "shopify_handle": row.shopify_handle,
                    "brand": row.brand,
                    "model": row.model,
                    "status": row.status,
                    "primary_track_size": row.primary_track_size,
                    "hero_url": row.hero_url or "",
                    "track_count": len(row.track_product_handles),
                    "uc_count": len(row.uc_product_handles),
                    "notes": "; ".join(row.notes),
                }
            )


def write_api_manifest(path: Path, rows: list[ModelPublishRow], handle_to_gid: dict[str, str]) -> dict[str, Any]:
    manifest: dict[str, Any] = {"models": []}
    for row in rows:
        track_gids = [handle_to_gid[h] for h in row.track_product_handles if h in handle_to_gid]
        uc_gids = [handle_to_gid[h] for h in row.uc_product_handles if h in handle_to_gid]
        manifest["models"].append(
            {
                "handle": row.shopify_handle,
                "machine_id": row.machine_id,
                "primary_track_size": row.primary_track_size,
                "hero_url": row.hero_url,
                "track_product_gids": track_gids,
                "uc_product_gids": uc_gids,
                "status": row.status,
            }
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
