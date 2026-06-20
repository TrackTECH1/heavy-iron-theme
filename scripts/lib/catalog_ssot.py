"""Shared SSOT helpers — itemid-keyed catalog (TNT300525N80HD)."""
from __future__ import annotations

import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROJECT_REF = "tcykyktvdlsbscrsbjyt"
DEFAULT_SUPABASE_URL = f"https://{PROJECT_REF}.supabase.co"
STORAGE_BUCKET = "catalog-images"
CANONICAL_JSON = ROOT / "data" / "tracktech-canonical.json"
TRACK_IMAGE_OVERRIDES_PATH = ROOT / "data" / "track-image-urls.json"
HI_TRACK_IMAGES_MASTER_CSV = ROOT / "data" / "hi-track-images-master.csv"
HI_TRACK_IMAGES_SHEET_ID = "1qWXfSX22p7BgsMJpNmzdMHjWM129OTngjIP3mUVh8m4"

# Shopify handle tread slug → catalog_images.tread_pattern (heavy_iron_images_MASTER sheet)
HANDLE_TREAD_SLUGS: dict[str, str] = {
    "multi-bar": "Multi-Bar",
    "mx": "MX",
    "directional": "Directional",
    "c-block": "C-Block",
    "block": "Staggered Block",  # supplier Block Pattern → HI Staggered Block
    "offset-block": "Offset Block",
    "zig-zag": "Zig-Zag",
    "x-terrain": "X-Terrain",
    "staggered-block": "Staggered Block",
    "all-terrain": "All-Terrain",
    "z-max": "Z-Max",
    "bar": "Multi-Bar",
}

_master_track_images_cache: dict[str, list[str]] | None = None
_master_track_images_mtime: float | None = None
TRACKTECH_EXPORT_DIR = Path.home() / "Desktop/SUPABASE"
DEFAULT_TRACKTECH_EXPORT = (
    TRACKTECH_EXPORT_DIR / "tracktech-products-2026-06-20T19-10-15.csv"
)
DEFAULT_TRACKTECH_EXPORT_XLSX = (
    TRACKTECH_EXPORT_DIR / "tracktech-products-2026-06-20T19-10-10.xlsx"
)

KNOWN_MAKES = {
    "bobcat", "cat", "case", "komatsu", "kubota", "takeuchi", "new holland", "new-holland",
    "john deere", "gehl", "yanmar", "hitachi", "jcb", "volvo", "ihi", "kobelco", "sumitomo",
    "wacker neuson", "wacker-neuson", "doosan", "hyundai", "mustang", "asv", "terex",
    "link-belt", "sany", "takeuchi", "vermeer", "volvo", "ditch witch", "kioti",
}

TREAD_FROM_SUPPLIER = {
    "dr pattern": "Directional",
    "directional": "Directional",
    "nd pattern": "ND",
    "mx pattern": "MX",
    "multi-bar pattern": "Multi-Bar",
    "c-block pattern": "C-Block",
    "c pattern": "C-Block",
    "zig-zag pattern": "Zig-Zag",
    "zb pattern": "Zig-Zag",  # supplier ZB Pattern → HI Zig-Zag
    "z pattern": "Z-Max",  # supplier Z Pattern → HI Z-Max
    "z-max pattern": "Z-Max",
    "staggered block pattern": "Staggered Block",
    "x-terrain pattern": "X-Terrain",
    "all-terrain pattern": "All-Terrain",
    "bd pattern": "All-Terrain",  # supplier BD Pattern → HI All-Terrain
    "block pattern": "Staggered Block",  # supplier Block Pattern → HI Staggered Block
    "v pattern": "V Pattern",
    "t-bar pattern": "T-Bar",
    "standard pattern": "Standard",
}

# Canonical tread codes → catalog_images.tread_pattern / storefront display
CATALOG_TREAD_ALIASES = {
    "C": "C-Block",
    "ZB": "Zig-Zag",
    "Z": "Z-Max",
    "MB": "Multi-Bar",
    "XT": "X-Terrain",
    "BL": "Staggered Block",
    "BD": "All-Terrain",
    "Block": "Staggered Block",
    "DR": "Directional",
    "ND": "ND",
    "MX": "MX",
    "V": "V Pattern",
    "SB": "Staggered Block",
    "ZZ": "Zig-Zag",
    "AT": "All-Terrain",
    "XTERRAIN": "X-Terrain",
}

# Common skid-steer / CTL width (mm) → marketed inch size
WIDTH_MM_TO_INCH: dict[int, str] = {
    150: "6",
    160: "6",
    180: "7",
    230: "9",
    240: "9.5",
    250: "10",
    300: "12",
    400: "16",
    450: "18",
    700: "28",
}

# CID attachment catalog — separate from TrackTech/MWE tracks + UC pipeline.
# HT/CT in supplier data are hybrid tracks/pads, not attachments.
ATTACHMENT_ITEMID_PREFIXES = ("BO", "MB", "CO")

# Not carried on Heavy Iron — OTT over-tire tracks, solid tires, OTT hardware, wheels/rims.
EXCLUDED_CATALOG_PREFIXES = ("TNTOTT", "TNTWL")
EXCLUDED_CATALOG_ITEMID_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^TNT\d+X\d+RT$", re.I),  # OTT over-tire tracks (TNT10x26RT …)
    re.compile(r"^TNT13\.00-24", re.I),  # solid rubber tires
    re.compile(r"^TNT14\.00-24", re.I),
    re.compile(r"^TNT30X", re.I),  # 10-16.5 solid tires
    re.compile(r"^TNT33X", re.I),  # 12-16.5 / 12-18 solid tires
    re.compile(r"^TNT650-10TND", re.I),
    re.compile(r"^\d+X\d+LM$", re.I),  # OTT link tracks as UC SKUs (10X28LM …)
)
EXCLUDED_CATALOG_EXACT = frozenset({"9073"})  # OTT carriage bolt kit

UC_ITEMID_PREFIXES = (
    "TR", "FI", "SP", "CR", "RR",
    "FII", "TRR", "TRI", "CRR", "SPR", "FIR", "CRY", "CRP", "CRL", "SPI", "SPP", "FIV",
)


def is_excluded_catalog_itemid(itemid: str | None) -> bool:
    """OTT tracks, solid tires, OTT links/pads, wheels/rims — not carried on Heavy Iron."""
    if not itemid:
        return False
    upper = itemid.strip().upper()
    if upper in EXCLUDED_CATALOG_EXACT:
        return True
    if upper.startswith(EXCLUDED_CATALOG_PREFIXES):
        return True
    if "OTT" in upper:
        return True
    return any(p.search(upper) for p in EXCLUDED_CATALOG_ITEMID_PATTERNS)


def is_attachment_itemid(itemid: str | None) -> bool:
    """True for CID attachment SKUs (BO/MB/CO). Not in TrackTech export."""
    if not itemid:
        return False
    upper = itemid.strip().upper()
    return any(upper.startswith(p) for p in ATTACHMENT_ITEMID_PREFIXES)


def is_catalog_itemid(itemid: str | None) -> bool:
    """TrackTech/MWE itemids managed by itemid_ssot pipeline (tracks + UC)."""
    if not itemid or is_attachment_itemid(itemid) or is_excluded_catalog_itemid(itemid):
        return False
    upper = itemid.strip().upper()
    if upper.startswith("TNT"):
        return True
    return any(upper.startswith(p) for p in UC_ITEMID_PREFIXES)


def is_shopify_attachment(product: dict) -> bool:
    """Shopify-side attachment product (CID catalog — do not wipe/sync/overwrite)."""
    ptype = (product.get("productType") or "").lower()
    if "attachment" in ptype:
        return True
    if (product.get("templateSuffix") or "").lower() == "attachment":
        return True
    tags = [str(t).lower() for t in (product.get("tags") or [])]
    return any(t in ("cid-attachments", "nav:attachments") for t in tags)


def is_catalog_shopify_product(product: dict) -> bool:
    """Shopify product owned by itemid_ssot pipeline (safe to wipe/re-sync)."""
    if is_shopify_attachment(product):
        return False
    tags = product.get("tags") or []
    if "itemid-ssot" in tags:
        return True
    mf = product.get("metafield") or {}
    return bool((mf.get("value") or "").strip())


def load_dotenv_fitment() -> None:
    path = ROOT / ".env.fitment.local"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = val.strip().strip('"').strip("'")


def supabase_url() -> str:
    return os.environ.get("SUPABASE_URL", DEFAULT_SUPABASE_URL)


def supabase_key() -> str | None:
    return os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


def supabase_request(
    method: str,
    path: str,
    body: dict | list | None = None,
    prefer: str | None = None,
    retries: int = 4,
) -> bytes:
    key = supabase_key()
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY required")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if prefer:
        headers["Prefer"] = prefer
    url = f"{supabase_url()}/rest/v1/{path}"
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ssl.SSLError) as e:
            last_err = e
            retryable = isinstance(
                e, (urllib.error.URLError, TimeoutError, OSError, ssl.SSLError)
            ) or (
                isinstance(e, urllib.error.HTTPError) and e.code in (408, 429, 500, 502, 503, 504)
            )
            if retryable and attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
    raise last_err or RuntimeError("supabase_request failed")


def supabase_get_all(path: str, page_size: int = 1000) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        sep = "&" if "?" in path else "?"
        paged = f"{path}{sep}limit={page_size}&offset={offset}"
        batch = json.loads(supabase_request("GET", paged))
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def normalize_supplier_tread(raw: str | None) -> str | None:
    if not raw:
        return None
    key = raw.strip().lower()
    if key in TREAD_FROM_SUPPLIER:
        return TREAD_FROM_SUPPLIER[key]
    for pat, norm in TREAD_FROM_SUPPLIER.items():
        if pat in key:
            return norm
    cleaned = raw.replace(" Pattern", "").strip()
    return CATALOG_TREAD_ALIASES.get(cleaned, cleaned)


def display_tread_pattern(tread: str | None) -> str | None:
    if not tread:
        return None
    return CATALOG_TREAD_ALIASES.get(tread.strip(), tread.strip())


def normalize_track_size(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", "", value).lower()


def track_size_digit_groups(value: str | None) -> list[str]:
    if not value:
        return []
    return re.findall(r"\d+(?:\.\d+)?", value)


def track_size_matches(filter_value: str, track_size: str | None) -> bool:
    if not track_size:
        return False
    if normalize_track_size(filter_value) == normalize_track_size(track_size):
        return True
    groups = track_size_digit_groups(filter_value)
    if len(groups) < 3:
        return False
    size_digits = track_size_digit_groups(track_size)
    if len(size_digits) < len(groups):
        return False
    idx = 0
    for group in groups:
        while idx < len(size_digits) and size_digits[idx] != group:
            idx += 1
        if idx >= len(size_digits):
            return False
        idx += 1
    return True


def resolve_tracktech_export(path: Path | None = None) -> Path:
    if path is not None and path.is_file():
        return path
    if DEFAULT_TRACKTECH_EXPORT.is_file():
        return DEFAULT_TRACKTECH_EXPORT
    if TRACKTECH_EXPORT_DIR.is_dir():
        candidates = sorted(
            TRACKTECH_EXPORT_DIR.glob("tracktech-products-*"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for candidate in candidates:
            if candidate.suffix.lower() in {".csv", ".xlsx", ".xls"}:
                return candidate
    return DEFAULT_TRACKTECH_EXPORT


def iter_tracktech_export_rows(export_path: Path):
    """Yield export rows as dicts (CSV or xlsx)."""
    suffix = export_path.suffix.lower()
    if suffix == ".csv":
        import csv

        with export_path.open(newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                yield {k: (v.strip() if isinstance(v, str) and v.strip() else v or None) for k, v in row.items()}
        return
    if suffix in {".xlsx", ".xls"}:
        import openpyxl

        wb = openpyxl.load_workbook(export_path, read_only=True, data_only=True)
        try:
            ws = wb[wb.sheetnames[0]]
            header = next(ws.iter_rows(values_only=True))
            cols = [h for h in header if h]
            idx = {h: i for i, h in enumerate(header) if h}

            def col(row, name):
                i = idx.get(name)
                return row[i] if i is not None and i < len(row) else None

            for row in ws.iter_rows(min_row=2, values_only=True):
                yield {name: col(row, name) for name in cols}
        finally:
            wb.close()
        return
    raise ValueError(f"Unsupported TrackTech export format: {export_path.suffix}")


def normalize_track_size_for_images(track_size: str | None) -> str:
    """Normalize export track sizes to catalog_images keys (Bx→x, strip N/W/K pitch suffixes)."""
    if not track_size:
        return ""
    s = re.sub(r"\s+", "", track_size.strip())
    s = re.sub(r"(?<=\d)[Bb]x(?=\d)", "x", s)
    parts = re.split(r"[xX]", s)
    if len(parts) >= 2:
        parts[1] = re.sub(r"^(\d+(?:\.\d+)?)[NnWwKk]$", r"\1", parts[1])
    if len(parts) >= 3:
        parts[2] = re.sub(r"^[NnWwKk]", "", parts[2])
    return "x".join(parts)


def track_size_image_variants(track_size: str | None) -> list[str]:
    """Track sizes for catalog_images lookup (Bx vs x, N/W/K pitch variants, etc.)."""
    if not track_size:
        return []
    seen: set[str] = set()
    variants: list[str] = []
    for cand in (track_size.strip(), normalize_track_size_for_images(track_size)):
        if not cand or cand in seen:
            continue
        seen.add(cand)
        variants.append(cand)
        alt = re.sub(r"(?<=\d)[Bb]x(?=\d)", "x", cand)
        if alt not in seen:
            seen.add(alt)
            variants.append(alt)
    return variants


# Same-tread naming only (supplier vs HI display). Never borrow another tread's photos.
TREAD_IMAGE_FALLBACKS: dict[str, list[str]] = {
    "Block": ["Staggered Block"],
    "Staggered-Block": ["Staggered Block"],
}


def lookup_catalog_images(
    image_map: dict[tuple[str, str], list[dict]],
    track_size: str | None,
    tread: str | None,
) -> list[dict]:
    tread_norm = display_tread_pattern(tread) or tread or ""
    treads_to_try: list[str] = []
    for tr in (tread_norm, tread or ""):
        if tr and tr not in treads_to_try:
            treads_to_try.append(tr)
    for alt in TREAD_IMAGE_FALLBACKS.get(tread_norm, []):
        if alt not in treads_to_try:
            treads_to_try.append(alt)

    for ts in track_size_image_variants(track_size):
        for tr in treads_to_try:
            imgs = image_map.get((ts, tr))
            if imgs:
                return imgs
    return []


def format_title_track_size(track_size: str | None) -> str:
    """Normalize track size for title parens: 450x86Bx60 → 450x86x60."""
    if not track_size:
        return ""
    s = re.sub(r"\s+", "", track_size.strip())
    s = re.sub(r"(?<=\d)[Bb]x(?=\d)", "x", s)
    parts = re.split(r"[xX]", s)
    if len(parts) >= 3:
        parts[1] = re.sub(r"^(\d+(?:\.\d+)?)[NnWwKk]$", r"\1", parts[1])
    return "x".join(parts)


def parse_inch_from_product_name(product_name: str | None) -> str | None:
    if not product_name:
        return None
    m = re.match(r'^(\d+(?:\.\d+)?)"\s', product_name.strip())
    return m.group(1) if m else None


def derive_inch_size(
    width_mm: float | int | str | None = None,
    track_size: str | None = None,
    product_name: str | None = None,
) -> str | None:
    inch = parse_inch_from_product_name(product_name)
    if inch:
        return inch
    width: float | None = None
    if width_mm is not None and str(width_mm).strip():
        try:
            width = float(width_mm)
        except (TypeError, ValueError):
            width = None
    if width is None and track_size:
        groups = track_size_digit_groups(track_size)
        if groups:
            try:
                width = float(groups[0])
            except (TypeError, ValueError):
                width = None
    if width is None:
        return None
    w_int = int(round(width))
    if w_int in WIDTH_MM_TO_INCH:
        return WIDTH_MM_TO_INCH[w_int]
    inches = width / 25.4
    rounded = round(inches * 2) / 2
    if rounded == int(rounded):
        return str(int(rounded))
    return str(rounded)


def format_heavy_iron_title(
    track_size: str | None,
    tread_pattern: str | None,
    width_mm: float | int | str | None = None,
    *,
    product_name: str | None = None,
    fallback: str | None = None,
) -> str:
    """Heavy Duty 18\" C-Block Rubber Track  (450x86x60)."""
    if not track_size or not tread_pattern:
        return fallback or ""
    tread = normalize_supplier_tread(tread_pattern) or tread_pattern
    tread_name = display_tread_pattern(tread) or tread
    size_display = format_title_track_size(track_size)
    inch = derive_inch_size(width_mm, track_size, product_name)
    if inch:
        return f'Heavy Duty {inch}" {tread_name} Rubber Track  ({size_display})'
    return f"Heavy Duty {tread_name} Rubber Track  ({size_display})"


def format_track_title(
    track_size: str | None,
    tread: str | None,
    fallback: str | None = None,
    width_mm: float | int | str | None = None,
    product_name: str | None = None,
) -> str:
    return format_heavy_iron_title(
        track_size,
        tread,
        width_mm,
        product_name=product_name,
        fallback=fallback,
    )


def resolve_product_title(
    itemid: str,
    *,
    product_name: str | None = None,
    supplier_product_name: str | None = None,
    track_size: str | None = None,
    tread_pattern: str | None = None,
    width_mm: float | int | str | None = None,
    supplier_title: bool = True,
    fallback: str | None = None,
) -> str:
    """Resolve storefront title. Default mirrors supplier/export product_name."""
    name = (supplier_product_name or product_name or "").strip() or None
    fb = fallback or itemid
    if supplier_title:
        return name or fb
    if track_size and tread_pattern:
        return format_heavy_iron_title(
            track_size,
            tread_pattern,
            width_mm,
            product_name=name,
            fallback=fb,
        )
    return name or fb


def slugify_make(make: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", make.lower().replace("-", " ")).strip("-")


def slugify_model(model: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", model.lower()).strip("-")


def parse_fitment_csv(text: str) -> list[tuple[str, str]]:
    if not text or not text.strip():
        return []
    text = text.strip()
    if text.startswith("[") and text.endswith("]"):
        try:
            items = json.loads(text.replace("'", '"'))
            pairs = []
            for item in items:
                parts = str(item).split(None, 1)
                if len(parts) == 2:
                    pairs.append((parts[0].strip(), parts[1].strip()))
            return pairs
        except (json.JSONDecodeError, ValueError):
            pass

    parts = [p.strip() for p in text.split(",") if p.strip()]
    pairs: list[tuple[str, str]] = []
    current_make: str | None = None
    i = 0
    while i < len(parts):
        token = parts[i]
        token_lower = token.lower().replace("-", " ")
        looks_like_make = token_lower in KNOWN_MAKES or any(token_lower.startswith(m) for m in KNOWN_MAKES)
        if looks_like_make:
            current_make = token.replace("-", " ")
            i += 1
            continue
        if current_make:
            pairs.append((current_make, token))
        i += 1
    return pairs


def storage_public_url(storage_path: str) -> str:
    base = supabase_url().rstrip("/")
    return f"{base}/storage/v1/object/public/{STORAGE_BUCKET}/{storage_path.lstrip('/')}"


IMAGE_ROLE_ORDER = {"hero": 0, "tread_detail": 1, "alt": 2, "steel_cord": 3}


def urls_from_catalog_image_rows(rows: list[dict]) -> list[str]:
    urls: list[str] = []
    for img in sorted(rows, key=lambda x: IMAGE_ROLE_ORDER.get(x.get("role") or "", 99)):
        path = img.get("storage_path")
        if path:
            u = storage_public_url(path)
            if u not in urls:
                urls.append(u)
    return urls


def load_track_image_overrides() -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Optional local URLs: by_itemid and by_size_tread (key: 450x86x60|C-Block)."""
    if not TRACK_IMAGE_OVERRIDES_PATH.is_file():
        return {}, {}
    try:
        raw = json.loads(TRACK_IMAGE_OVERRIDES_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}, {}
    by_itemid: dict[str, list[str]] = {}
    for key, val in (raw.get("by_itemid") or {}).items():
        if not key or key.startswith("_"):
            continue
        urls = [u.strip() for u in val if isinstance(u, str) and u.strip().startswith("http")]
        if urls:
            by_itemid[key.strip().upper()] = urls
    by_size_tread: dict[str, list[str]] = {}
    for key, val in (raw.get("by_size_tread") or {}).items():
        if not key or key.startswith("_"):
            continue
        urls = [u.strip() for u in val if isinstance(u, str) and u.strip().startswith("http")]
        if urls:
            by_size_tread[key.strip()] = urls
    return by_itemid, by_size_tread


def normalize_master_storage_url(url: str) -> str:
    """Sheet uses nested paths; bucket stores flat files at catalog-images/ or catalog-images/sizes/."""
    if "/catalog-images/" not in url:
        return url
    filename = url.rstrip("/").split("/")[-1]
    prefix = url.split("/catalog-images/")[0]
    size_key = filename.rsplit(".", 1)[0].split("-", 1)[0]
    # 493/596 at bucket root; 102/596 under sizes/ (ag decimals like 160x87.63x28, compact keys like 1807244).
    use_sizes_subdir = "x" not in size_key.lower() or bool(
        re.match(r"^\d+x\d+\.\d+x\d+", size_key, re.I)
    )
    if use_sizes_subdir:
        return f"{prefix}/catalog-images/sizes/{filename}"
    return f"{prefix}/catalog-images/{filename}"


def parse_master_image_handle(handle: str) -> tuple[str, str] | None:
    """160x87.63x28-rubber-track-multi-bar → (size, tread pattern)."""
    m = re.match(r"^(.+)-rubber-track-(.+)$", (handle or "").strip(), re.I)
    if not m:
        return None
    size = m.group(1)
    slug = m.group(2).lower()
    tread = display_tread_pattern(HANDLE_TREAD_SLUGS.get(slug, slug)) or HANDLE_TREAD_SLUGS.get(slug, slug)
    return size, tread


def load_hi_master_track_images() -> dict[str, list[str]]:
    """Google Sheet export: Handle + Image Src rows → size|tread → [urls]."""
    global _master_track_images_cache, _master_track_images_mtime
    path = HI_TRACK_IMAGES_MASTER_CSV
    if not path.is_file():
        return {}
    mtime = path.stat().st_mtime
    if _master_track_images_cache is not None and _master_track_images_mtime == mtime:
        return _master_track_images_cache

    import csv
    from collections import defaultdict

    grouped: dict[str, list[tuple[int, str]]] = defaultdict(list)
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            handle = (row.get("Handle") or "").strip()
            url = normalize_master_storage_url((row.get("Image Src") or "").strip())
            if not handle or not url.startswith("http"):
                continue
            parsed = parse_master_image_handle(handle)
            if not parsed:
                continue
            size, tread = parsed
            try:
                pos = int(row.get("Image Position") or 99)
            except (TypeError, ValueError):
                pos = 99
            for sz in {size, normalize_track_size_for_images(size)}:
                if not sz:
                    continue
                key = size_tread_override_key(sz, tread)
                grouped[key].append((pos, url))

    out: dict[str, list[str]] = {}
    for key, pairs in grouped.items():
        seen: set[str] = set()
        ordered: list[str] = []
        for _, url in sorted(pairs, key=lambda x: x[0]):
            if url not in seen:
                seen.add(url)
                ordered.append(url)
        out[key] = ordered

    _master_track_images_cache = out
    _master_track_images_mtime = mtime
    return out


def master_urls_for_size_tread(
    master: dict[str, list[str]],
    track_size: str | None,
    tread_pattern: str | None,
) -> list[str]:
    for ts in track_size_image_variants(track_size):
        key = size_tread_override_key(ts, tread_pattern)
        urls = master.get(key)
        if urls:
            return urls
    return []


def size_tread_override_key(track_size: str | None, tread_pattern: str | None) -> str:
    tread = display_tread_pattern(tread_pattern) or tread_pattern or ""
    size = normalize_track_size_for_images(track_size) or (track_size or "")
    return f"{size}|{tread}"


def load_catalog_image_maps() -> tuple[dict[tuple[str, str], list[dict]], dict[str, list[dict]]]:
    """Supabase catalog_images indexed by (track_size, tread) and by itemid."""
    try:
        rows = supabase_get_all(
            "catalog_images?select=id,track_size,tread_pattern,role,storage_path,alt_text,itemid"
        )
    except urllib.error.HTTPError:
        rows = supabase_get_all(
            "catalog_images?select=id,track_size,tread_pattern,role,storage_path,alt_text"
        )
    by_size_tread: dict[tuple[str, str], list[dict]] = {}
    by_itemid: dict[str, list[dict]] = {}
    for row in rows:
        key = (row.get("track_size") or "", row.get("tread_pattern") or "")
        by_size_tread.setdefault(key, []).append(row)
        iid = (row.get("itemid") or "").strip().upper()
        if iid:
            by_itemid.setdefault(iid, []).append(row)
    return by_size_tread, by_itemid


def resolve_track_gallery_urls(
    itemid: str,
    track_size: str | None,
    tread_pattern: str | None,
    *,
    image_map: dict[tuple[str, str], list[dict]] | None = None,
    itemid_image_map: dict[str, list[dict]] | None = None,
    url_overrides: tuple[dict[str, list[str]], dict[str, list[str]]] | None = None,
    max_images: int = 10,
) -> list[str]:
    """Heavy Iron track images — master sheet, Supabase bucket, optional track-image-urls.json."""
    urls: list[str] = []
    iid = itemid.strip().upper()
    by_itemid, by_size_tread = url_overrides if url_overrides is not None else load_track_image_overrides()
    master = load_hi_master_track_images()

    for u in by_itemid.get(iid, []):
        if u not in urls:
            urls.append(u)

    if itemid_image_map:
        for u in urls_from_catalog_image_rows(itemid_image_map.get(iid, [])):
            if u not in urls:
                urls.append(u)

    st_key = size_tread_override_key(track_size, tread_pattern)
    for u in by_size_tread.get(st_key, []):
        if u not in urls:
            urls.append(u)

    for u in master_urls_for_size_tread(master, track_size, tread_pattern):
        if u not in urls:
            urls.append(u)

    if image_map:
        for u in urls_from_catalog_image_rows(
            lookup_catalog_images(image_map, track_size, tread_pattern)
        ):
            if u not in urls:
                urls.append(u)

    return urls[:max_images]


def resolve_product_gallery_urls(
    itemid: str,
    product_type: str,
    track_size: str | None = None,
    tread_pattern: str | None = None,
    *,
    image_map: dict[tuple[str, str], list[dict]] | None = None,
    itemid_image_map: dict[str, list[dict]] | None = None,
    supplier_image_urls: str | None = None,
    cached_supabase: list[dict] | None = None,
    cached_supplier: list[str] | None = None,
    max_images: int = 10,
) -> list[str]:
    """Tracks: HI sources only. UC parts: HI first, MWE supplier fallback."""
    if product_type == "track":
        return resolve_track_gallery_urls(
            itemid,
            track_size,
            tread_pattern,
            image_map=image_map,
            itemid_image_map=itemid_image_map,
            max_images=max_images,
        )

    urls: list[str] = []
    if cached_supabase:
        for entry in cached_supabase:
            u = entry.get("url") if isinstance(entry, dict) else entry
            if u and u not in urls:
                urls.append(u)
    for u in cached_supplier or parse_supplier_images(supplier_image_urls):
        if u not in urls:
            urls.append(u)
    return urls[:max_images]


def parse_supplier_images(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [u.strip() for u in raw.split("|") if u.strip().startswith("http")]


def load_canonical_items() -> list[dict]:
    return json.loads(CANONICAL_JSON.read_text(encoding="utf-8"))


def supplier_by_itemid() -> dict[str, dict]:
    rows = supabase_get_all(
        "supplier_master?select=itemid,shopify_sku,product_name,cost,track_size,track_pattern,"
        "width_mm,pitch_mm,links,weight,warranty,warehouse_availability,qty_pricing,"
        "fitment_models,image_urls,qty_available,in_stock"
    )
    grouped: dict[str, dict] = {}
    for row in rows:
        itemid = (row.get("itemid") or "").strip()
        if not itemid:
            continue
        if itemid not in grouped:
            grouped[itemid] = {**row, "shopify_skus": []}
        sku = row.get("shopify_sku")
        if sku and sku not in grouped[itemid]["shopify_skus"]:
            grouped[itemid]["shopify_skus"].append(sku)
        # prefer row with fitment text
        if row.get("fitment_models") and len(str(row["fitment_models"])) > len(str(grouped[itemid].get("fitment_models") or "")):
            grouped[itemid]["fitment_models"] = row["fitment_models"]
        if row.get("product_name") and not grouped[itemid].get("product_name"):
            grouped[itemid]["product_name"] = row["product_name"]
    return grouped


def catalog_images_by_size_tread() -> dict[tuple[str, str], list[dict]]:
    by_size_tread, _ = load_catalog_image_maps()
    return by_size_tread
