"""Map production + local image sources onto dev core.media_asset junctions."""

from __future__ import annotations

import csv
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from lib.catalog_ssot import (
    HI_TRACK_IMAGES_MASTER_CSV,
    load_dotenv_fitment,
    load_hi_master_track_images,
    normalize_track_size_for_images,
    parse_master_image_handle,
    supabase_get_all,
)
from lib.track_size_from_specs import normalize_spec_track_size

ROOT = Path(__file__).resolve().parents[2]
PROD_REF = "tcykyktvdlsbscrsbjyt"
PROD_PUBLIC = f"https://{PROD_REF}.supabase.co/storage/v1/object/public"
HERO_MANIFEST = ROOT / "data/model-hero-images-manifest.json"
CORE_PRODUCT_CSV = ROOT / "data/tracktech-source-of-truth-package/02_import_csvs/core_product.csv"
CORE_MODEL_CSV = ROOT / "data/tracktech-source-of-truth-package/02_import_csvs/core_model.csv"
TRACK_SIZE_V2_CSV = ROOT / "supabase/quality-audit/track_size_master_v2.csv"

ROLE_RANK = {"hero": 0, "tread_detail": 1, "gallery": 2, "alt": 3, "steel_cord": 4}


@dataclass
class MediaAsset:
    media_id: str
    url: str
    storage_bucket: str | None = None
    storage_path: str | None = None
    alt_text: str | None = None
    role: str = "gallery"
    source_system: str = ""
    source_ref: str = ""

    def sql_tuple(self) -> str:
        def q(v: str | None) -> str:
            if v is None or v == "":
                return "NULL"
            return "'" + v.replace("'", "''") + "'"

        return (
            f"({q(self.media_id)}, {q(self.url)}, {q(self.storage_bucket)}, {q(self.storage_path)}, "
            f"{q(self.alt_text)}, {q(self.role)}, {q(self.source_system)}, {q(self.source_ref)})"
        )


@dataclass
class MappingRow:
    source_system: str
    source_ref: str
    url: str
    entity_type: str
    entity_id: str
    entity_label: str
    tread_pattern: str | None = None
    display_priority: int = 1
    status: str = "mapped"


@dataclass
class ReviewRow:
    source_url: str
    detected_entity_type: str | None
    detected_ref: str | None
    reason: str
    source_system: str = ""


@dataclass
class MediaBuildResult:
    assets: dict[str, MediaAsset] = field(default_factory=dict)
    model_links: list[tuple[str, str, int]] = field(default_factory=list)
    track_links: list[tuple[str, str, str | None, int]] = field(default_factory=list)
    product_links: list[tuple[str, str, int]] = field(default_factory=list)
    mappings: list[MappingRow] = field(default_factory=list)
    reviews: list[ReviewRow] = field(default_factory=list)

    def add_asset(self, asset: MediaAsset) -> str:
        existing = self.assets.get(asset.media_id)
        if existing:
            if ROLE_RANK.get(asset.role, 99) < ROLE_RANK.get(existing.role, 99):
                self.assets[asset.media_id] = asset
            return asset.media_id
        self.assets[asset.media_id] = asset
        return asset.media_id


def normalize_size_key(size: str | None) -> str:
    if not size:
        return ""
    return normalize_spec_track_size(size).replace("bx", "x")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:60]


def media_id_for(url: str, prefix: str = "x") -> str:
    h = hashlib.sha1(url.encode()).hexdigest()[:12]
    return f"media_{slug(prefix)}_{h}"


def is_image_url(url: str | None) -> bool:
    if not url or not url.startswith("http"):
        return False
    lower = url.lower()
    if lower.endswith((".webp", ".jpg", ".jpeg", ".png", ".gif")):
        return True
    if "cdn.shopify.com" in lower and "/files/" in lower:
        return True
    if f"{PROD_REF}.supabase.co/storage/" in lower:
        return True
    if "mwedealers.com" in lower or "newrubbertrack.com" in lower:
        return False
    return "/storage/v1/object/public/" in lower


def storage_public_url(bucket: str, path: str) -> str:
    path = path.lstrip("/")
    return f"{PROD_PUBLIC}/{bucket}/{path}"


def parse_storage_url(url: str) -> tuple[str | None, str | None]:
    m = re.search(r"/storage/v1/object/public/([^/]+)/(.+)$", url)
    if not m:
        return None, None
    return m.group(1), m.group(2)


def catalog_role(raw: str | None, position: int = 99) -> str:
    if raw:
        r = raw.lower()
        if r == "hero":
            return "hero"
        if "detail" in r:
            return "tread_detail"
    return "hero" if position == 1 else "gallery"


@dataclass
class DevIndexes:
    product_by_sku: dict[str, str]
    machine_by_handle: dict[str, str]
    machine_by_id: dict[str, str]
    track_by_key: dict[str, str]
    track_by_id: dict[str, str]
    track_canonical: dict[str, str]


def load_dev_indexes() -> DevIndexes:
    product_by_sku: dict[str, str] = {}
    with CORE_PRODUCT_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            sku = (row.get("sku") or "").strip()
            pid = (row.get("product_id") or "").strip()
            if sku and pid:
                product_by_sku[sku.upper()] = pid

    machine_by_handle: dict[str, str] = {}
    machine_by_id: dict[str, str] = {}
    with CORE_MODEL_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            mid = (row.get("machine_id") or "").strip()
            handle = (row.get("shopify_handle") or "").strip().lower()
            model = (row.get("model") or "").strip()
            if mid:
                machine_by_id[mid] = model
            if handle and mid:
                machine_by_handle[handle] = mid

    track_by_key: dict[str, str] = {}
    track_by_id: dict[str, str] = {}
    track_canonical: dict[str, str] = {}
    with TRACK_SIZE_V2_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tid = row["track_size_id"]
            canonical = row["canonical_size"]
            track_by_id[tid] = canonical
            track_canonical[tid] = canonical
            for variant in {canonical, normalize_track_size_for_images(canonical)}:
                track_by_key[normalize_size_key(variant)] = tid

    return DevIndexes(
        product_by_sku=product_by_sku,
        machine_by_handle=machine_by_handle,
        machine_by_id=machine_by_id,
        track_by_key=track_by_key,
        track_by_id=track_by_id,
        track_canonical=track_canonical,
    )


def resolve_track_size_id(indexes: DevIndexes, raw_size: str | None) -> str | None:
    if not raw_size:
        return None
    for cand in {raw_size.strip(), normalize_track_size_for_images(raw_size)}:
        tid = indexes.track_by_key.get(normalize_size_key(cand))
        if tid:
            return tid
    return None


def resolve_product_id(indexes: DevIndexes, itemid: str | None) -> str | None:
    if not itemid:
        return None
    return indexes.product_by_sku.get(itemid.strip().upper())


def resolve_machine_id(indexes: DevIndexes, handle: str | None) -> str | None:
    if not handle:
        return None
    return indexes.machine_by_handle.get(handle.strip().lower())


def ingest_catalog_images(indexes: DevIndexes, result: MediaBuildResult) -> None:
    rows = supabase_get_all(
        "catalog_images?select=id,track_size,tread_pattern,role,storage_path,alt_text,itemid"
    )
    for row in rows:
        path = (row.get("storage_path") or "").strip()
        if not path:
            continue
        url = storage_public_url("catalog-images", path)
        tid = resolve_track_size_id(indexes, row.get("track_size"))
        tread = (row.get("tread_pattern") or "").strip() or None
        role = catalog_role(row.get("role"))
        pos = 1 if role == "hero" else 2
        ref = f"catalog_images:{row.get('id')}"

        if tid:
            mid = media_id_for(url, tid)
            asset = MediaAsset(
                media_id=mid,
                url=url,
                storage_bucket="catalog-images",
                storage_path=path,
                alt_text=(row.get("alt_text") or "").strip() or None,
                role=role,
                source_system="production.catalog_images",
                source_ref=ref,
            )
            result.add_asset(asset)
            result.track_links.append((tid, mid, tread, pos))
            result.mappings.append(
                MappingRow(
                    source_system="production.catalog_images",
                    source_ref=ref,
                    url=url,
                    entity_type="track_size",
                    entity_id=tid,
                    entity_label=indexes.track_canonical.get(tid, tid),
                    tread_pattern=tread,
                    display_priority=pos,
                )
            )
            continue

        itemid = (row.get("itemid") or "").strip()
        pid = resolve_product_id(indexes, itemid)
        if pid:
            mid = media_id_for(url, pid)
            asset = MediaAsset(
                media_id=mid,
                url=url,
                storage_bucket="catalog-images",
                storage_path=path,
                alt_text=(row.get("alt_text") or "").strip() or None,
                role=role,
                source_system="production.catalog_images",
                source_ref=ref,
            )
            result.add_asset(asset)
            result.product_links.append((pid, mid, pos))
            result.mappings.append(
                MappingRow(
                    source_system="production.catalog_images",
                    source_ref=ref,
                    url=url,
                    entity_type="product",
                    entity_id=pid,
                    entity_label=itemid,
                    display_priority=pos,
                )
            )
            continue

        result.reviews.append(
            ReviewRow(
                source_url=url,
                detected_entity_type="track_size",
                detected_ref=row.get("track_size"),
                reason="catalog_images row has no v2 track_size_id or product match",
                source_system="production.catalog_images",
            )
        )


def ingest_hi_master_csv(indexes: DevIndexes, result: MediaBuildResult) -> None:
    if not HI_TRACK_IMAGES_MASTER_CSV.is_file():
        return
    with HI_TRACK_IMAGES_MASTER_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            handle = (row.get("Handle") or "").strip()
            url = (row.get("Image Src") or "").strip()
            if not handle or not is_image_url(url):
                continue
            parsed = parse_master_image_handle(handle)
            if not parsed:
                result.reviews.append(
                    ReviewRow(url, "unknown", handle, "unparseable HI master handle", "hi_master_csv")
                )
                continue
            size, tread = parsed
            tid = resolve_track_size_id(indexes, size)
            try:
                pos = int(row.get("Image Position") or 99)
            except (TypeError, ValueError):
                pos = 99
            role = "hero" if pos == 1 else "gallery"
            bucket, path = parse_storage_url(url)
            if not tid:
                result.reviews.append(
                    ReviewRow(url, "track_size", size, "no v2 track_size_id", "hi_master_csv")
                )
                continue
            mid = media_id_for(url, tid)
            if mid in result.assets:
                result.track_links.append((tid, mid, tread, pos))
                continue
            asset = MediaAsset(
                media_id=mid,
                url=url,
                storage_bucket=bucket,
                storage_path=path,
                alt_text=(row.get("Image Alt Text") or "").strip() or None,
                role=role,
                source_system="hi_master_csv",
                source_ref=handle,
            )
            result.add_asset(asset)
            result.track_links.append((tid, mid, tread, pos))
            result.mappings.append(
                MappingRow(
                    source_system="hi_master_csv",
                    source_ref=handle,
                    url=url,
                    entity_type="track_size",
                    entity_id=tid,
                    entity_label=indexes.track_canonical.get(tid, size),
                    tread_pattern=tread,
                    display_priority=pos,
                )
            )


def ingest_production_products(indexes: DevIndexes, result: MediaBuildResult) -> None:
    rows = supabase_get_all("product?select=itemid,sku,image_url,track_size,tread_pattern")
    for row in rows:
        url = (row.get("image_url") or "").strip()
        if not is_image_url(url):
            continue
        itemid = (row.get("itemid") or row.get("sku") or "").strip()
        pid = resolve_product_id(indexes, itemid)
        if not pid:
            result.reviews.append(
                ReviewRow(url, "product", itemid, "no core.product match", "production.product")
            )
            continue
        mid = media_id_for(url, pid)
        bucket, path = parse_storage_url(url)
        asset = MediaAsset(
            media_id=mid,
            url=url,
            storage_bucket=bucket,
            storage_path=path,
            alt_text=None,
            role="hero",
            source_system="production.product",
            source_ref=itemid,
        )
        result.add_asset(asset)
        result.product_links.append((pid, mid, 1))
        result.mappings.append(
            MappingRow(
                source_system="production.product",
                source_ref=itemid,
                url=url,
                entity_type="product",
                entity_id=pid,
                entity_label=itemid,
                display_priority=1,
            )
        )


def ingest_supplier_master(indexes: DevIndexes, result: MediaBuildResult) -> None:
    rows = supabase_get_all("supplier_master?select=itemid,image_urls")
    for row in rows:
        itemid = (row.get("itemid") or "").strip()
        pid = resolve_product_id(indexes, itemid)
        raw = (row.get("image_urls") or "").strip()
        if not raw:
            continue
        urls = [u.strip() for u in raw.split("|") if u.strip()]
        for i, url in enumerate(urls, start=1):
            if not is_image_url(url):
                if url.startswith("http"):
                    result.reviews.append(
                        ReviewRow(
                            url,
                            "product",
                            itemid,
                            "supplier URL is not an image (skipped)",
                            "production.supplier_master",
                        )
                    )
                continue
            if not pid:
                result.reviews.append(
                    ReviewRow(url, "product", itemid, "no core.product match", "production.supplier_master")
                )
                continue
            mid = media_id_for(url, f"{pid}_{i}")
            bucket, path = parse_storage_url(url)
            asset = MediaAsset(
                media_id=mid,
                url=url,
                storage_bucket=bucket,
                storage_path=path,
                role="gallery" if i > 1 else "hero",
                source_system="production.supplier_master",
                source_ref=itemid,
            )
            result.add_asset(asset)
            result.product_links.append((pid, mid, i))
            result.mappings.append(
                MappingRow(
                    source_system="production.supplier_master",
                    source_ref=itemid,
                    url=url,
                    entity_type="product",
                    entity_id=pid,
                    entity_label=itemid,
                    display_priority=i,
                )
            )


def ingest_model_heroes_production(indexes: DevIndexes, result: MediaBuildResult) -> None:
    rows = supabase_get_all(
        "model?select=model_key,model_handle,hero_image_path,hero_source_url,hero_image_alt"
    )
    for row in rows:
        handle = (row.get("model_handle") or row.get("model_key") or "").strip().lower()
        source = (row.get("hero_source_url") or "").strip()
        path = (row.get("hero_image_path") or "").strip()
        if path:
            url = storage_public_url("machine-images", path)
        elif is_image_url(source):
            url = source
        else:
            continue
        machine_id = resolve_machine_id(indexes, handle)
        if not machine_id:
            result.reviews.append(
                ReviewRow(url, "model", handle, "no core.model shopify_handle match", "production.model")
            )
            continue
        mid = media_id_for(url, machine_id)
        bucket, spath = parse_storage_url(url)
        asset = MediaAsset(
            media_id=mid,
            url=url,
            storage_bucket=bucket or "machine-images",
            storage_path=spath or path,
            alt_text=(row.get("hero_image_alt") or "").strip() or None,
            role="hero",
            source_system="production.model",
            source_ref=handle,
        )
        result.add_asset(asset)
        result.model_links.append((machine_id, mid, 1))
        result.mappings.append(
            MappingRow(
                source_system="production.model",
                source_ref=handle,
                url=url,
                entity_type="model",
                entity_id=machine_id,
                entity_label=indexes.machine_by_id.get(machine_id, handle),
                display_priority=1,
            )
        )


def ingest_hero_manifest(indexes: DevIndexes, result: MediaBuildResult) -> None:
    if not HERO_MANIFEST.is_file():
        return
    for entry in json.loads(HERO_MANIFEST.read_text()):
        url = (entry.get("public_url") or entry.get("source_url") or "").strip()
        handle = (entry.get("handle") or entry.get("model_key") or "").strip().lower()
        if not is_image_url(url) or not handle:
            continue
        machine_id = resolve_machine_id(indexes, handle)
        if not machine_id:
            result.reviews.append(
                ReviewRow(url, "model", handle, "manifest handle not in core.model", "model_hero_manifest")
            )
            continue
        mid = media_id_for(url, machine_id)
        if any(m == machine_id for m, _, _ in result.model_links):
            continue
        bucket, path = parse_storage_url(url)
        asset = MediaAsset(
            media_id=mid,
            url=url,
            storage_bucket=bucket,
            storage_path=path,
            alt_text=(entry.get("alt") or "").strip() or None,
            role="hero",
            source_system="model_hero_manifest",
            source_ref=handle,
        )
        result.add_asset(asset)
        result.model_links.append((machine_id, mid, 1))
        result.mappings.append(
            MappingRow(
                source_system="model_hero_manifest",
                source_ref=handle,
                url=url,
                entity_type="model",
                entity_id=machine_id,
                entity_label=indexes.machine_by_id.get(machine_id, handle),
                display_priority=1,
            )
        )


def dedupe_links(result: MediaBuildResult) -> None:
    seen_track: set[tuple[str, str]] = set()
    track: list[tuple[str, str, str | None, int]] = []
    for link in result.track_links:
        k = (link[0], link[1])
        if k in seen_track:
            continue
        seen_track.add(k)
        track.append(link)
    result.track_links = track

    seen_prod: set[tuple[str, str]] = set()
    prod: list[tuple[str, str, int]] = []
    for link in result.product_links:
        k = (link[0], link[1])
        if k in seen_prod:
            continue
        seen_prod.add(k)
        prod.append(link)
    result.product_links = prod

    seen_model: set[str] = set()
    model: list[tuple[str, str, int]] = []
    for link in result.model_links:
        if link[0] in seen_model:
            continue
        seen_model.add(link[0])
        model.append(link)
    result.model_links = model


def build_media_layer() -> MediaBuildResult:
    load_dotenv_fitment()
    indexes = load_dev_indexes()
    result = MediaBuildResult()

    ingest_catalog_images(indexes, result)
    ingest_hi_master_csv(indexes, result)
    ingest_production_products(indexes, result)
    ingest_supplier_master(indexes, result)
    ingest_model_heroes_production(indexes, result)
    ingest_hero_manifest(indexes, result)
    dedupe_links(result)
    return result


def write_mapping_report(path: Path, result: MediaBuildResult) -> None:
    fields = [
        "source_system",
        "source_ref",
        "url",
        "entity_type",
        "entity_id",
        "entity_label",
        "tread_pattern",
        "display_priority",
        "status",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for m in result.mappings:
            w.writerow(
                {
                    "source_system": m.source_system,
                    "source_ref": m.source_ref,
                    "url": m.url,
                    "entity_type": m.entity_type,
                    "entity_id": m.entity_id,
                    "entity_label": m.entity_label,
                    "tread_pattern": m.tread_pattern or "",
                    "display_priority": m.display_priority,
                    "status": m.status,
                }
            )


def write_review_queue(path: Path, result: MediaBuildResult) -> None:
    fields = ["source_url", "detected_entity_type", "detected_ref", "reason", "source_system"]
    seen: set[str] = set()
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in result.reviews:
            if not r.source_url or r.source_url in seen:
                continue
            seen.add(r.source_url)
            w.writerow(
                {
                    "source_url": r.source_url,
                    "detected_entity_type": r.detected_entity_type or "",
                    "detected_ref": r.detected_ref or "",
                    "reason": r.reason,
                    "source_system": r.source_system,
                }
            )


def write_migration_sql(path: Path, result: MediaBuildResult) -> None:
    lines = [
        "-- Generated by scripts/build-media-layer.py",
        "-- Bridges production media → dev core.media_asset + junctions",
        "",
        "TRUNCATE core.model_media, core.track_size_media, core.product_media, core.media_review_queue CASCADE;",
        "DELETE FROM core.media_asset;",
        "",
    ]

    assets = list(result.assets.values())
    batch = 100
    for i in range(0, len(assets), batch):
        chunk = assets[i : i + batch]
        lines.append(
            "INSERT INTO core.media_asset (media_id, url, storage_bucket, storage_path, alt_text, role, source_system, source_ref)"
        )
        lines.append("VALUES")
        lines.append(",\n".join(a.sql_tuple() for a in chunk))
        lines.append("ON CONFLICT (media_id) DO UPDATE SET url = EXCLUDED.url, alt_text = EXCLUDED.alt_text;")
        lines.append("")

    for tid, mid, tread, pos in result.track_links:
        tread_sql = "NULL" if not tread else "'" + tread.replace("'", "''") + "'"
        lines.append(
            f"INSERT INTO core.track_size_media (track_size_id, media_id, tread_pattern, display_priority)\n"
            f"VALUES ('{tid}', '{mid}', {tread_sql}, {pos})\n"
            f"ON CONFLICT (track_size_id, media_id) DO NOTHING;"
        )

    lines.append("")
    for pid, mid, pos in result.product_links:
        lines.append(
            f"INSERT INTO core.product_media (product_id, media_id, display_priority)\n"
            f"VALUES ('{pid}', '{mid}', {pos})\n"
            f"ON CONFLICT (product_id, media_id) DO NOTHING;"
        )

    lines.append("")
    for machine_id, mid, pos in result.model_links:
        lines.append(
            f"INSERT INTO core.model_media (machine_id, media_id, role, display_priority)\n"
            f"VALUES ('{machine_id}', '{mid}', 'hero', {pos})\n"
            f"ON CONFLICT (machine_id, media_id) DO NOTHING;"
        )

    lines.append("")
    for r in result.reviews:
        if not r.source_url:
            continue
        et = "NULL" if not r.detected_entity_type else "'" + r.detected_entity_type.replace("'", "''") + "'"
        ref = "NULL" if not r.detected_ref else "'" + r.detected_ref.replace("'", "''") + "'"
        lines.append(
            f"INSERT INTO core.media_review_queue (source_url, detected_entity_type, detected_ref, reason)\n"
            f"VALUES ('{r.source_url.replace(chr(39), chr(39)+chr(39))}', {et}, {ref}, '{r.reason.replace(chr(39), chr(39)+chr(39))}');"
        )

    path.write_text("\n".join(lines) + "\n")
