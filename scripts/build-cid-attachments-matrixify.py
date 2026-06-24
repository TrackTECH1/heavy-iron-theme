#!/usr/bin/env python3
"""Build CID attachment Matrixify CSV: PDF baseline + HISC family shells.

Family + variants model:
  - ~87+ cid-* Shopify products (families)
  - One variant per PDF SKU (942 target), unique Variant SKU each
  - Prices/weight from CID Attachments Catalogue.pdf (Retail = price, Dealer+ = cost)

Usage:
  python3 scripts/build-cid-attachments-matrixify.py
  python3 scripts/build-cid-attachments-matrixify.py --pdf ~/path/CID\\ Attachments\\ Catalogue.pdf
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from lib.catalog_ssot import load_dotenv_fitment, retail_pricing_from_cost, supabase_get_all  # noqa: E402

DEFAULT_PDF = Path.home() / "Library/CloudStorage/GoogleDrive-sales@newrubbertrack.com/My Drive/CID Attachments Catalogue.pdf"
DEFAULT_HISC = Path.home() / "Desktop/SUPABASE/HISC_attachments_recovery.csv"
OUTPUT_CSV = ROOT / "data/cid-attachments-matrixify.csv"
REPORT_CSV = ROOT / "data/cid-attachments-family-report.csv"
FAMILY_SPECS_DIR = ROOT / "data/cid-attachment-families"

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
    "Published Scope",
    "Template Suffix",
    "Top Row",
    "Option1 Name",
    "Option1 Value",
    "Option2 Name",
    "Option2 Value",
    "Option3 Name",
    "Option3 Value",
    "Variant SKU",
    "Variant Price",
    "Variant Compare At Price",
    "Variant Cost",
    "Variant Weight",
    "Variant Weight Unit",
    "Variant Inventory Policy",
    "Variant Inventory Tracker",
    "Variant Fulfillment Service",
    "Variant Requires Shipping",
    "Variant Taxable",
    "Image Src",
    "Image Position",
    "Image Alt Text",
    "Variant Metafield: custom.attachment_specs [json]",
]

SKIP_SKUS = frozenset({"OPTIONAL", "ADDITIONAL", "EXCAVATOR", "PULL", "EXCM", "NEW"})

# PDF wrap artifacts / column bleed — not real SKUs
INVALID_SKU_WORDS = frozenset({
    "TEETH", "GPM", "LBS", "REQUIRES", "QUANTITY", "FORKS", "FRAME", "CASE", "DRAIN",
    "REQUIRED", "DINGO", "FOR", "INCLUDES", "DECK", "HOOK-UP", "HOOKUP", "MULCHING",
    "X-TREME", "XTREME", "OR", "USS", "AND", "WITH", "THE", "ONLY", "PACKAGE",
    "AUGER", "BACKHOE", "BOOM", "BRUSH", "BUCKETS", "FORK", "FRAMES", "GRAPPLE",
    "GROUND", "MANURE", "EXCM", "SNOW", "RIPPER", "LEVELER", "BLADE", "RAKE",
})

DEFAULT_BODY = (
    "<p><strong>{title}</strong> is a jobsite-ready CID attachment for contractors who need "
    "dependable performance without wasted downtime.</p>"
    "<ul>"
    "<li><strong>Heavy-duty build</strong> for construction, grading, land clearing, and material handling.</li>"
    "<li><strong>Machine compatibility support</strong> — confirm coupler, mount, hydraulic flow, and sizing before purchase.</li>"
    "<li><strong>Freight support</strong> available for large attachments.</li>"
    "</ul>"
    "<p>Heavy Iron Supply Co. supplies CID attachments, rubber tracks, and undercarriage parts nationwide.</p>"
)

# Canonical family titles for handles not in HISC recovery (slug → display title).
HANDLE_TITLE_OVERRIDES: dict[str, str] = {
    "cid-auger-bits": "CID Auger Bits & Adapters",
    "cid-auger-drive": "CID Auger Drive",
    "cid-backhoe-bucket": "CID Backhoe Bucket",
    "cid-backhoe-frame": "CID Backhoe Frame",
    "cid-bolt-on-finishing-rake": "Bolt-On Finishing Rake",
    "cid-compact-tractor-dual-cyl-grapple-rake": "Compact Tractor Dual-Cylinder Grapple Rake",
    "cid-compact-tractor-frame": "Compact Tractor Frame",
    "cid-compact-tractor-grapple-rake": "Compact Tractor Grapple Rake",
    "cid-compact-tractor-rock-grapple": "Compact Tractor Rock Grapple",
    "cid-concrete-bucket": "CID Concrete Bucket",
    "cid-dozer-blade": "CID Dozer Blade",
    "cid-excavator-adaptor-plate": "Excavator Adaptor Plate",
    "cid-excavator-cutter": "Excavator Cutter",
    "cid-excavator-mount": "Excavator Mount",
    "cid-excavator-root-rake": "Excavator Root Rake",
    "cid-fixed-tree-saw": "Fixed Tree Saw",
    "cid-fork-frame": "Fork Frame",
    "cid-fork-grapple": "Fork Grapple",
    "cid-hay-equipment": "Hay Equipment",
    "cid-hay-spear": "Hay Spear",
    "cid-hydraulic-breaker": "CID Hydraulic Breaker",
    "cid-manual-tree-saw": "Manual Tree Saw",
    "cid-manure-fork": "Manure Fork",
    "cid-mat-grapple": "Mat Grapple",
    "cid-mini-frame": "Mini Loader Frame",
    "cid-multi-way-head": "Multi-Way Head",
    "cid-3-point-hitch-quick-attach": "3-Point Hitch Quick Attach",
    "cid-pallet-fork-frame": "Pallet Fork & Frame",
    "cid-post-driver": "CID Post Driver",
    "cid-post-driver-mount": "Post Driver Mount",
    "cid-quick-attach-plate": "Quick Attach Plate",
    "cid-receiver-hitch": "Receiver Hitch",
    "cid-rock-bucket": "Rock Bucket",
    "cid-root-grapple": "Root Grapple",
    "cid-severe-duty-grapple-rake": "Severe-Duty Grapple Rake",
    "cid-skid-frame": "Skid Steer Frame",
    "cid-skid-steer-adapter": "Skid Steer Adapter Plate",
    "cid-sod-roller": "Sod Roller",
    "cid-standard-duty-excavator-cutter": "Standard-Duty Excavator Cutter",
    "cid-stump-grapple": "Stump Grapple",
    "cid-sub-compact-tractor-frame": "Sub-Compact Tractor Frame",
    "cid-tooth-bar": "Tooth Bar",
    "cid-tree-shear": "Tree Shear",
    "cid-tree-spade": "Tree Spade",
    "cid-tree-stump-remover": "Tree & Stump Remover",
    "cid-trencher-chain": "Trencher Chain",
    "cid-attachment": "Trencher Attachment",
    "cid-boom-pole": "Boom Pole",
    "cid-telescopic-boom-pole": "Telescopic Boom Pole",
}

TITLE_ACRONYMS = frozenset({
    "HD", "XD", "SD", "SV", "CT", "MP", "TL", "BC", "GR", "RB", "LB", "LP", "EX", "RR", "CID",
    "GPM", "MT50", "USS", "JD", "QA", "II", "III", "IV", "MT", "RC30", "QA", "N/A",
})
TITLE_SMALL_WORDS = frozenset({"for", "and", "or", "with", "to", "the", "a", "an", "of", "on", "in"})
HANDLE_TOKEN_MAP = {
    "4n1": "4-N-1",
    "xtreme": "X-Treme",
    "hd": "HD",
    "xd": "XD",
    "sd": "SD",
    "sv": "SV",
    "ct": "CT",
    "mp": "MP",
    "tl": "TL",
    "bc": "BC",
    "gr": "GR",
    "rb": "RB",
    "lb": "LB",
    "lp": "LP",
    "mt50": "MT50",
    "gpm": "GPM",
    "sub": "Sub",
    "compact": "Compact",
    "tractor": "Tractor",
    "cid": "CID",
}


@dataclass
class PdfSku:
    sku: str
    name: str
    dealer: float
    retail: float
    weight_lbs: float | None = None
    pg: int | None = None


@dataclass
class Family:
    handle: str
    title: str = ""
    body_html: str = ""
    vendor: str = "CID Attachments"
    product_type: str = "Skid Steer Attachment"
    tags: str = "Attachment, cid-attachments"
    status: str = "active"
    published: str = "TRUE"
    template_suffix: str = "attachment"
    image_src: str = ""
    image_alt: str = ""
    variants: dict[str, dict] = field(default_factory=dict)  # sku -> variant row fields
    source: str = "hisc"  # hisc | inferred | new


def parse_money(val: str) -> float:
    return float(val.replace(",", "").replace("$", "").strip())


def is_valid_sku(sku: str) -> bool:
    if sku in SKIP_SKUS or sku in INVALID_SKU_WORDS or sku.isdigit() or len(sku) < 2:
        return False
    if re.fullmatch(r"\d+-\d+", sku):
        return False
    if not re.search(r"\d", sku) and len(sku) < 4:
        return False
    return True


def normalize_pdf_lines(text: str) -> list[str]:
    """Join only true wrap continuations (parenthetical tails), never section headers."""
    raw = [" ".join(line.split()) for line in text.splitlines() if line.strip()]
    merged: list[str] = []
    buf = ""
    price_tail = re.compile(
        r"\$[\d,]+(?:\.\d+)?(?:\s+\$[\d,]+(?:\.\d+)?)?(?:\s+[\d,]+(?:\.\d+)?)?\s*$"
    )
    product_start = re.compile(r"^(?:\d+\s+)?(?:New\s+)?[A-Z0-9][A-Z0-9./\-]{1,40}?\s+", re.I)

    for line in raw:
        if "PG SKU" in line or line.startswith("--"):
            continue

        if buf and (
            line.startswith("(")
            or line.upper().startswith(("CASE DRAIN", "NO CASE DRAIN", "MULCHING TEETH"))
        ):
            buf = f"{buf} {line}"
            if price_tail.search(buf):
                merged.append(buf)
                buf = ""
            continue

        if buf:
            if price_tail.search(buf):
                merged.append(buf)
            buf = ""

        if product_start.match(line) and "$" in line:
            merged.append(line)
        elif product_start.match(line):
            buf = line

    if buf and price_tail.search(buf):
        merged.append(buf)
    return merged


def parse_pdf(path: Path) -> dict[str, PdfSku]:
    from pypdf import PdfReader

    text = "\n".join(page.extract_text() or "" for page in PdfReader(str(path)).pages)
    out: dict[str, PdfSku] = {}
    for line in normalize_pdf_lines(text):
        if not line or "$" not in line:
            continue
        m = re.match(
            r"^(?:(\d+)\s+)?(?:New\s+)?([A-Z0-9][A-Z0-9./\-]{1,40}?)\s+(.+?)\s+\$([\d,]+(?:\.\d+)?)"
            r"(?:\s+\$([\d,]+(?:\.\d+)?))?(?:\s+([\d,]+(?:\.\d+)?))?$",
            line,
            re.I,
        )
        if not m:
            continue
        pg = int(m.group(1)) if m.group(1) else None
        sku = m.group(2).strip().upper().rstrip(".")
        if not is_valid_sku(sku):
            continue
        name = m.group(3).strip()
        if not re.search(r"[A-Za-z]{3,}", name):
            continue
        dealer = parse_money(m.group(4))
        retail = parse_money(m.group(5)) if m.group(5) else dealer
        weight = parse_money(m.group(6)) if m.group(6) else None
        out[sku] = PdfSku(sku=sku, name=name, dealer=dealer, retail=retail, weight_lbs=weight, pg=pg)
    return out


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return re.sub(r"-+", "-", s)[:80]


def smart_title_case(text: str) -> str:
    """Readable title case; preserve acronyms and existing mixed-case strings."""
    text = re.sub(r"\s+", " ", text.strip().rstrip(","))
    if not text:
        return text
    letters = [c for c in text if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) < 0.55:
        return text

    def fix_token(token: str, *, first: bool) -> str:
        low = token.lower()
        if low == "x-treme":
            return "X-Treme"
        if low == "w/":
            return "w/"
        up = token.upper()
        if up in TITLE_ACRONYMS:
            return up
        if re.fullmatch(r"\d+-\d+", token):
            return token
        if re.fullmatch(r"\d+N\d+", up):
            return token.upper().replace("N", "-N-", 1)
        if not first and low in TITLE_SMALL_WORDS:
            return low
        if "-" in token:
            return "-".join(fix_token(part, first=first) for part in token.split("-"))
        return token.capitalize()

    words = text.split()
    return " ".join(fix_token(w, first=(i == 0)) for i, w in enumerate(words))


def title_from_handle(handle: str) -> str:
    if handle in HANDLE_TITLE_OVERRIDES:
        return HANDLE_TITLE_OVERRIDES[handle]
    slug = handle.removeprefix("cid-")
    words = [HANDLE_TOKEN_MAP.get(w, w.capitalize()) for w in slug.split("-") if w]
    return " ".join(words)


def family_title_from_name(name: str) -> str:
    t = re.sub(r"\s+\d+\s*[”\"].*$", "", name, flags=re.I)
    t = re.sub(r",\s*\d+.*$", "", t)
    t = re.sub(r"\s+FOR\s+\w+.*$", "", t, flags=re.I)
    t = re.sub(r"\s+\d+-\d+\s*GPM.*$", "", t, flags=re.I)
    t = re.sub(r"\s*\(.*?(CASE DRAIN|NO CASE DRAIN).*?\)\s*$", "", t, flags=re.I)
    return smart_title_case(t.strip().rstrip(","))


def title_needs_fix(title: str) -> bool:
    if not title or title.endswith(","):
        return True
    letters = [c for c in title if c.isalpha()]
    if not letters:
        return True
    return sum(c.isupper() for c in letters) / len(letters) > 0.85


def load_attachment_family_specs() -> dict[str, dict]:
    """Load data/cid-attachment-families/*.json keyed by handle."""
    out: dict[str, dict] = {}
    if not FAMILY_SPECS_DIR.is_dir():
        return out
    for path in sorted(FAMILY_SPECS_DIR.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"Skip {path.name}: {exc}", file=sys.stderr)
            continue
        handle = (payload.get("handle") or path.stem).strip()
        if handle:
            out[handle] = payload
    return out


def parse_width_in(option_value: str, sku: str) -> int | None:
    m = re.search(r'(\d+)\s*"?', option_value or "")
    if m:
        return int(m.group(1))
    m = re.search(r"(\d{2,3})", sku or "")
    return int(m.group(1)) if m else None


def build_attachment_specs_json(
    fam: Family,
    sku: str,
    variant: dict,
    family_payload: dict | None,
    import_build_row: dict | None = None,
) -> str:
    specs: dict = {}

    if import_build_row:
        sb_specs = import_build_row.get("specs")
        if _import_build_specs_populated(sb_specs):
            specs.update(sb_specs)
        size_in = import_build_row.get("size_in")
        if size_in is not None:
            specs.setdefault("width_in", size_in)
        has_teeth = import_build_row.get("has_teeth")
        if has_teeth is not None:
            specs.setdefault("has_teeth", has_teeth)
        family_name = (import_build_row.get("family_name") or "").strip()
        if family_name:
            specs.setdefault("family", family_name)

    if family_payload:
        defaults = family_payload.get("family_spec_defaults") or {}
        if isinstance(defaults, dict):
            specs.update(defaults)
        overrides = (family_payload.get("variant_specs") or {}).get(sku) or {}
        if isinstance(overrides, dict):
            specs.update(overrides)

    width = parse_width_in(variant.get("Option1 Value") or "", sku)
    if width is not None:
        specs["width_in"] = width

    teeth = (variant.get("Option2 Value") or "").strip()
    if teeth:
        specs["teeth"] = teeth
        if teeth == "With Teeth":
            specs["weld_on_teeth"] = "With Teeth"
        elif teeth == "Standard":
            specs["weld_on_teeth"] = specs.get("weld_on_teeth", "Optional")

    # PDF/Matrixify weight wins over Supabase (some attachment weights in DB are wrong).
    weight_raw = (variant.get("Variant Weight") or "").strip()
    if weight_raw:
        try:
            specs["weight_lbs"] = int(float(weight_raw))
        except ValueError:
            pass

    specs["sku"] = sku
    specs["family_handle"] = fam.handle
    if fam.title:
        specs["family_title"] = fam.title

    # Drop empty values; keep 0/false.
    cleaned = {k: v for k, v in specs.items() if v is not None and v != ""}
    return json.dumps(cleaned, separators=(",", ":"))


def apply_family_enrichment(families: dict[str, Family], family_specs: dict[str, dict]) -> None:
    for handle, payload in family_specs.items():
        fam = families.get(handle)
        if not fam:
            continue
        if payload.get("title"):
            fam.title = str(payload["title"])
        if payload.get("body_html"):
            fam.body_html = str(payload["body_html"])


def load_supabase_attachments() -> dict[str, dict]:
    try:
        load_dotenv_fitment()
        rows = supabase_get_all(
            "product?select=sku,title,image_url,image_alt,attachment_category,weight_lbs"
            "&source=eq.attachment_catalog"
        )
        return {(r.get("sku") or "").strip().upper(): r for r in rows if (r.get("sku") or "").strip()}
    except Exception as exc:
        print(f"Supabase attachment_catalog skipped: {exc}", file=sys.stderr)
        return {}


def _import_build_specs_populated(specs: object) -> bool:
    return isinstance(specs, dict) and bool(specs)


def load_cid_import_build() -> dict[str, dict]:
    """Per-SKU specs + metadata from Supabase cid_import_build (272 SKUs with specs)."""
    try:
        load_dotenv_fitment()
        rows = supabase_get_all(
            "cid_import_build?select=sku,specs,image_file,handle,family_name,size_in,has_teeth,weight_lbs"
        )
        return {(r.get("sku") or "").strip().upper(): r for r in rows if (r.get("sku") or "").strip()}
    except Exception as exc:
        print(f"Supabase cid_import_build skipped: {exc}", file=sys.stderr)
        return {}


def finalize_family_metadata(
    families: dict[str, Family],
    pdf_skus: dict[str, PdfSku],
    supabase_by_sku: dict[str, dict],
) -> None:
    """Apply HISC-quality titles and Supabase images/categories after variant assignment."""
    for handle, fam in families.items():
        if fam.source == "hisc" and fam.title and not title_needs_fix(fam.title):
            pass
        elif handle in HANDLE_TITLE_OVERRIDES:
            fam.title = HANDLE_TITLE_OVERRIDES[handle]
        elif title_needs_fix(fam.title):
            pdf_titles = [
                family_title_from_name(pdf_skus[sku].name)
                for sku in fam.variants
                if sku in pdf_skus
            ]
            if pdf_titles:
                from collections import Counter

                fam.title = Counter(pdf_titles).most_common(1)[0][0]
            else:
                fam.title = title_from_handle(handle)

        if fam.source != "hisc" and (
            not fam.body_html.strip()
            or "jobsite-ready CID attachment" in fam.body_html
        ):
            fam.body_html = DEFAULT_BODY.format(title=fam.title)

        categories: set[str] = set()
        for sku in fam.variants:
            row = supabase_by_sku.get(sku)
            if not row:
                continue
            cat = (row.get("attachment_category") or "").strip()
            if cat:
                categories.add(cat.replace("_", "-"))
            if not fam.image_src and (row.get("image_url") or "").strip():
                fam.image_src = row["image_url"].strip()
                fam.image_alt = (row.get("image_alt") or fam.title).strip() or fam.title

        if categories and "cid-attachments" in fam.tags:
            cat_tags = ", ".join(sorted(categories))
            if cat_tags not in fam.tags:
                fam.tags = f"{fam.tags}, {cat_tags}"


def variant_options(sku: str, name: str, hisc_row: dict | None) -> dict[str, str]:
    if hisc_row and (hisc_row.get("Option1 Name") or "").strip():
        opts = {
            "Option1 Name": (hisc_row.get("Option1 Name") or "").strip(),
            "Option1 Value": (hisc_row.get("Option1 Value") or "").strip(),
            "Option2 Name": (hisc_row.get("Option2 Name") or "").strip(),
            "Option2 Value": (hisc_row.get("Option2 Value") or "").strip(),
            "Option3 Name": (hisc_row.get("Option3 Name") or "").strip(),
            "Option3 Value": (hisc_row.get("Option3 Value") or "").strip(),
        }
        if not opts["Option1 Value"]:
            opts["Option1 Value"] = infer_option_value(sku, name)
        return opts

    opt1_name = "Size"
    opt1_val = infer_option_value(sku, name)
    opt2_name = opt2_val = ""
    upper = name.upper()
    if "W/ TEETH" in upper or "W/TEETH" in upper or re.search(r"\bW/\s*TEETH\b", upper):
        opt2_name, opt2_val = "Teeth", "With Teeth"
    elif re.search(r"\bMT\b", sku) or "MULCHING TEETH" in upper:
        opt2_name, opt2_val = "Teeth", "Mulching Teeth"
    gpm = re.search(r"(\d+)\s*-\s*(\d+)\s*GPM", upper)
    if gpm and not opt2_name:
        opt2_name, opt2_val = "Flow (GPM)", f"{gpm.group(1)}-{gpm.group(2)} GPM"
    return {
        "Option1 Name": opt1_name,
        "Option1 Value": opt1_val,
        "Option2 Name": opt2_name,
        "Option2 Value": opt2_val,
        "Option3 Name": "",
        "Option3 Value": "",
    }


def infer_option_value(sku: str, name: str) -> str:
    m = re.search(r'(\d+)\s*[”"]', name)
    if m:
        return f'{m.group(1)}"'
    m = re.search(r"(\d+)\s*''", name)
    if m:
        return f'{m.group(1)}"'
    m = re.search(r",\s*(\d+)\s*[”\"]", name)
    if m:
        return f'{m.group(1)}"'
    m = re.search(r"\b(\d{2,3})\b", sku)
    if m:
        return f'{m.group(1)}"'
    return sku


def load_hisc(path: Path) -> tuple[dict[str, str], dict[str, Family], dict[str, dict]]:
    """Return sku_to_handle, families, sku_to_hisc_row."""
    sku_to_handle: dict[str, str] = {}
    sku_to_row: dict[str, dict] = {}
    families: dict[str, Family] = {}

    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            handle = (row.get("Handle") or "").strip()
            sku = (row.get("Variant SKU") or "").strip().upper()
            if not handle:
                continue
            if handle not in families:
                families[handle] = Family(
                    handle=handle,
                    title=(row.get("Title") or "").strip(),
                    body_html=(row.get("Body HTML") or "").strip(),
                    vendor=(row.get("Vendor") or "CID Attachments").strip(),
                    product_type=(row.get("Type") or "Skid Steer Attachment").strip(),
                    tags=(row.get("Tags") or "Attachment, cid-attachments").strip(),
                    status=(row.get("Status") or "active").strip(),
                    published=(row.get("Published") or "TRUE").strip(),
                    template_suffix=(row.get("Template Suffix") or "attachment").strip(),
                    image_src=(row.get("Image Src") or "").strip(),
                    image_alt=(row.get("Image Alt Text") or "").strip(),
                    source="hisc",
                )
            if sku:
                sku_to_handle[sku] = handle
                sku_to_row[sku] = row
    return sku_to_handle, families, sku_to_row


def name_family_key(name: str) -> str:
    """Group orphan SKUs by product line (strip size/GPM/machine suffix)."""
    n = name.upper()
    n = re.sub(r"\(.*?\)", " ", n)
    n = re.sub(r"\d+\s*[”\"].*$", "", n)
    n = re.sub(r",\s*\d+.*$", "", n)
    n = re.sub(r"\s+FOR\s+(DINGO|MT50|RC30|USS|MINI).*", "", n, flags=re.I)
    n = re.sub(r"\s+REQUIRES\s+.*", "", n, flags=re.I)
    n = re.sub(r"\s+NO CASE DRAIN.*", "", n, flags=re.I)
    n = re.sub(r"\s+CASE DRAIN.*", "", n, flags=re.I)
    n = re.sub(r"\s+\d+-\d+\s*GPM.*", "", n, flags=re.I)
    n = re.sub(r"^NEW\s+", "", n)
    n = re.sub(r"[^A-Z0-9 ]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return slugify(n[:72]) or "attachment"


def sku_stems(sku: str) -> list[str]:
    stems: list[str] = []
    parts = sku.split("-")
    for i in range(len(parts), 0, -1):
        stems.append("-".join(parts[:i]))
    m = re.match(r"^([A-Z]{2,})", sku)
    if m:
        stems.append(m.group(1))
    m2 = re.match(r"^(CID\d+)", sku)
    if m2:
        stems.append(m2.group(1))
    # trim numeric tail stem e.g. HD4N1 from HD4N1-84T
    trimmed = re.sub(r"[-]?\d+[A-Z]*$", "", sku)
    if trimmed and trimmed != sku:
        stems.append(trimmed)
    seen: set[str] = set()
    out: list[str] = []
    for s in stems:
        if s and s not in seen and len(s) >= 3:
            seen.add(s)
            out.append(s)
    return out


def build_stem_map(sku_to_handle: dict[str, str]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for sku, handle in sku_to_handle.items():
        for stem in sku_stems(sku):
            pairs.append((stem, handle))
    pairs.sort(key=lambda x: len(x[0]), reverse=True)
    return pairs


# Orphan SKUs → HISC handle when stem match is ambiguous (explicit rules).
SKU_PREFIX_HANDLE: list[tuple[str, str]] = [
    ("HD4N1", "cid-hd-4n1-bucket"),
    ("SD4N1", "cid-sd-4n1-bucket"),
    ("MINI4N1", "cid-mini-4n1-bucket"),
    ("X4N1", "cid-x-4n1-bucket"),
    ("SV4N1", "cid-sv-4n1-bucket"),
    ("HDRB", "cid-hd-rock-bucket"),
    ("XDRB", "cid-xd-rock-bucket"),
    ("SDVTRB", "cid-sd-rock-bucket"),
    ("CTRB", "cid-compact-tractor-grapple-bucket"),
    ("CTRAC", "cid-hd-tractor-bucket"),
    ("TRAC", "cid-hd-tractor-bucket"),
    ("XTRAC", "cid-xtreme-tractor-bucket"),
    ("LBB", "cid-lb-bucket"),
    ("LPB", "cid-lp-bucket"),
    ("SNLB", "cid-snow-litter-bucket"),
    ("TLB", "cid-turkey-litter-bucket"),
    ("HCSB", "cid-hc-snow-litter-bucket"),
    ("TAKB", "cid-xtreme-tl-bucket"),
    ("ITAKB", "cid-industrial-tl-bucket"),
    ("HDB", "cid-high-dump-bucket"),
    ("MINIAD", "cid-mini-tree-reaper-1015"),
    ("MB20", "cid-grapple-bucket-dingo"),
    ("MB15", "cid-grapple-bucket-dingo"),
    ("TR1626", "cid-tree-reaper-1626"),
    ("TR1727", "cid-tree-reaper-1727"),
    ("TR3048", "cid-tree-reaper-1626"),
    ("XBC1626", "cid-xtreme-bc-1626"),
    ("XBC1730", "cid-xtreme-bc-1626"),
    ("XBC2735", "cid-xtreme-bc-1626"),
    ("XC3048", "cid-xtreme-bc-3048"),
    ("XBCLF", "cid-xtreme-bc-lf"),
    ("XBCMF", "cid-xtreme-bc-mf"),
    ("TRD", "cid-mini-tree-reaper-1015"),
    ("TRMT", "cid-mini-tree-reaper-1015"),
    ("TRUNI", "cid-mini-tree-reaper-1015"),
    ("TRRC", "cid-mini-tree-reaper-1015"),
    ("MINI-XPWR", "cid-xtreme-mini-power-rake-hyd"),
    ("MINI-MPPR", "cid-mini-mp-power-rake"),
    ("SPUSH", "cid-xtreme-snow-pusher"),
    ("CTSPUSH", "cid-xtreme-snow-pusher"),
    ("XSPLOW", "cid-xtreme-snow-plow-hyd"),
    ("HDSPLOW", "cid-hd-snow-plow-hyd"),
    ("CTSPLOW", "cid-compact-tractor-snow-plow-hyd"),
    ("1/2YCB", "cid-concrete-bucket"),
    ("3/4YCB", "cid-concrete-bucket"),
    ("1YCB", "cid-concrete-bucket"),
    ("MINI1/4YCB", "cid-concrete-bucket"),
    ("XBHB", "cid-backhoe-bucket"),
    ("XBHS", "cid-backhoe-bucket"),
    ("XBHT", "cid-backhoe-bucket"),
    ("CBR", "cid-hydraulic-breaker"),
    ("PUBROOM", "cid-pickup-broom"),
    ("XHAB", "cid-xtreme-hyd-angle-blade"),
    ("XMAB", "cid-xtreme-man-angle-blade"),
    ("HAD", "cid-auger-drive"),
    ("RAD", "cid-auger-drive"),
    ("XHAD", "cid-auger-drive"),
    ("CID91", "cid-auger-bits"),
    ("CID92", "cid-auger-bits"),
    ("CID80", "cid-auger-bits"),
    ("CID81", "cid-auger-bits"),
    ("CID99", "cid-auger-bits"),
    ("CID917", "cid-auger-bits"),
    ("CID916", "cid-auger-bits"),
    ("CID914", "cid-auger-bits"),
    ("CID913", "cid-auger-bits"),
    ("CID912", "cid-auger-bits"),
    ("CID915", "cid-auger-bits"),
    ("CID808", "cid-auger-bits"),
    ("EXB", "cid-excavator-bucket-10k"),
    ("ICL", "cid-excavator-bucket-10k"),
    ("1CL3", "cid-excavator-bucket-10k"),
    ("KX040", "cid-excavator-bucket-kx040"),
    ("KX057", "cid-excavator-bucket-kx057"),
    ("KX080", "cid-excavator-bucket-kx080"),
    ("KX161", "cid-excavator-bucket-kx161"),
    ("HAG10", "cid-hay-equipment"),
    ("HAG", "cid-hay-equipment"),
    ("QAPLT", "cid-quick-attach-plate"),
    ("DQAP", "cid-quick-attach-plate"),
    ("MTQAP", "cid-quick-attach-plate"),
    ("2WAYHEAD", "cid-multi-way-head"),
    ("4WAYHEAD", "cid-multi-way-head"),
    ("3PTQAP", "cid-3-point-hitch-quick-attach"),
    ("BP", "cid-boom-pole"),
    ("XBP", "cid-boom-pole"),
    ("TBP", "cid-telescopic-boom-pole"),
    ("FTS", "cid-fixed-tree-saw"),
    ("MTS", "cid-manual-tree-saw"),
    ("CID203", "cid-trencher-chain"),
    ("CID204", "cid-trencher-chain"),
    ("EXAM", "cid-excavator-adaptor-plate"),
    ("BHFRAME", "cid-backhoe-frame"),
    ("PDM-", "cid-post-driver-mount"),
    ("PD750", "cid-post-driver"),
    ("PD1000", "cid-post-driver"),
    ("EXCM-", "cid-excavator-mount"),
    ("HBHS", "cid-hay-spear"),
    ("LBHS", "cid-hay-spear"),
    ("DHBHS", "cid-hay-spear"),
    ("DLBHS", "cid-hay-spear"),
    ("QUADHBHS", "cid-hay-spear"),
    ("QUADLBHS", "cid-hay-spear"),
    ("THBHS", "cid-hay-spear"),
    ("DHBABS", "cid-hay-spear"),
    ("HDFRAME", "cid-fork-frame"),
    ("WTFRAME", "cid-fork-frame"),
    ("XDFRAME", "cid-fork-frame"),
    ("QHDFRAME", "cid-fork-frame"),
    ("HDFF", "cid-pallet-fork-frame"),
    ("HHDFF", "cid-pallet-fork-frame"),
    ("HXDFF", "cid-pallet-fork-frame"),
    ("WTFF", "cid-pallet-fork-frame"),
    ("SDFF", "cid-pallet-fork-frame"),
    ("SCTFF", "cid-pallet-fork-frame"),
    ("CTFF", "cid-pallet-fork-frame"),
    ("FG", "cid-fork-grapple"),
    ("C3FG", "cid-fork-grapple"),
    ("C3MG", "cid-mat-grapple"),
    ("CID909", "cid-auger-bits"),
    ("CID944", "cid-auger-bits"),
    ("SST", "cid-skid-steer-adapter"),
    ("TSS", "cid-skid-steer-adapter"),
    ("TD", "cid-skid-steer-adapter"),
    ("TQ", "cid-skid-steer-adapter"),
    ("BTSS", "cid-skid-steer-adapter"),
    ("BHTSS", "cid-skid-steer-adapter"),
    ("GTSS", "cid-skid-steer-adapter"),
    ("METSS", "cid-skid-steer-adapter"),
    ("MTSS", "cid-skid-steer-adapter"),
    ("OSNHTSS", "cid-skid-steer-adapter"),
    ("POTSS", "cid-skid-steer-adapter"),
    ("QTSS", "cid-skid-steer-adapter"),
    ("RC30T", "cid-skid-steer-adapter"),
    ("YLTSS", "cid-skid-steer-adapter"),
    ("EXTMT50", "cid-skid-steer-adapter"),
    ("DPFRAME", "cid-mini-frame"),
    ("MTFRAME", "cid-mini-frame"),
    ("CTFRAME", "cid-compact-tractor-frame"),
    ("SDFRAME", "cid-skid-frame"),
    ("SCTFRAME", "cid-sub-compact-tractor-frame"),
    ("JD400CTFRAME", "cid-compact-tractor-frame"),
    ("JD500HDFRAME", "cid-pallet-fork-frame"),
    ("HSWTFRAME", "cid-fork-frame"),
    ("XBS", "cid-hay-equipment"),
    ("XCC", "cid-concrete-claw"),
    ("SB", "cid-stump-bucket"),
    ("XSB", "cid-stump-bucket"),
    ("SG", "cid-stump-grapple"),
    ("CTSG", "cid-stump-grapple"),
    ("TPP", "cid-tree-post-puller"),
    ("TTSR", "cid-tree-stump-remover"),
    ("TRSH", "cid-tree-shear"),
    ("NRTS", "cid-tree-shear"),
    ("GNRH", "cid-receiver-hitch"),
    ("RH", "cid-receiver-hitch"),
    ("SR", "cid-sod-roller"),
    ("HLS30T", "cid-post-driver"),
    ("ILS30T", "cid-post-driver"),
    ("SVEXCB", "cid-excavator-cutter"),
    ("XTLF", "cid-xtreme-rotary-tiller"),
]

# Name-based buckets for orphans (checked before per-name slug).
NAME_CATEGORY_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"HAY SPEAR|BALE SPEAR", re.I), "cid-hay-spear"),
    (re.compile(r"TO SKID STEER|TO DINGO|TO MT|TO QUICKIE|TO JD|CONVERSION", re.I), "cid-skid-steer-adapter"),
    (re.compile(r"FORKS?\s*&\s*FRAME|FORKS?\s+AND\s+FRAME|FORK FRAME", re.I), "cid-pallet-fork-frame"),
    (re.compile(r"QUICK ATTACH PLATE", re.I), "cid-quick-attach-plate"),
    (re.compile(r"BOOM POLE", re.I), "cid-boom-pole"),
    (re.compile(r"WAY HEAD", re.I), "cid-multi-way-head"),
    (re.compile(r"3 POINT HITCH", re.I), "cid-3-point-hitch-quick-attach"),
    (re.compile(r"EXCAVATOR MOUNT", re.I), "cid-excavator-mount"),
    (re.compile(r"POST DRIVER MOUNT|POST DRIVER", re.I), "cid-post-driver"),
    (re.compile(r"AUGER BIT", re.I), "cid-auger-bits"),
    (re.compile(r"CHAIN FOR TRENCHER|TRENCHER", re.I), "cid-trencher-chain"),
    (re.compile(r"TREE SHEAR", re.I), "cid-tree-shear"),
    (re.compile(r"ROOT GRAPPLE", re.I), "cid-root-grapple"),
    (re.compile(r"DOZER BLADE", re.I), "cid-dozer-blade"),
    (re.compile(r"MANURE FORK", re.I), "cid-manure-fork"),
]

MERGE_HANDLES: dict[str, str] = {
    "cid-auger-bit-hex": "cid-auger-bits",
    "cid-auger-bit-round": "cid-auger-bits",
    "cid-10-bale-hay-accumulator-grapple": "cid-hay-equipment",
    "cid-x-treme-hay-bale-squeezer": "cid-hay-equipment",
    "cid-3-point-hitch-quick-attach-cat-1": "cid-3-point-hitch-quick-attach",
    "cid-3-point-hitch-quick-attach-cat-2": "cid-3-point-hitch-quick-attach",
    "cid-3-square-boom-pole": "cid-boom-pole",
    "cid-4-square-boom-pole": "cid-boom-pole",
    "cid-2-way-head": "cid-multi-way-head",
    "cid-4-way-head": "cid-multi-way-head",
    "cid-4-way-dozer-blade": "cid-dozer-blade",
    "cid-6-way-dozer-blade": "cid-dozer-blade",
    "cid-adaptor-plate-for-excavator": "cid-excavator-adaptor-plate",
    "cid-bhframe": "cid-backhoe-frame",
    "cid-post-driver-mount-tilt-mech": "cid-post-driver-mount",
    "cid-post-driver-mount-universal-skid-steer": "cid-post-driver-mount",
    "cid-x-treme-post-driver-750": "cid-post-driver",
    "cid-x-treme-post-driver-1000": "cid-post-driver",
    "cid-quick-attach-plate-dingo": "cid-quick-attach-plate",
    "cid-quick-attach-plate-mt50": "cid-quick-attach-plate",
}


def infer_handle(sku: str, name: str, stem_pairs: list[tuple[str, str]]) -> str:
    for prefix, handle in sorted(SKU_PREFIX_HANDLE, key=lambda x: len(x[0]), reverse=True):
        if sku.startswith(prefix):
            return handle
    for stem, handle in stem_pairs:
        if sku.startswith(stem):
            return handle
    upper_name = name.upper()
    for pattern, handle in NAME_CATEGORY_RULES:
        if pattern.search(upper_name):
            return handle
    return f"cid-{name_family_key(name)}"


def merge_families(families: dict[str, Family]) -> dict[str, Family]:
    """Collapse alias handles and merge variant maps."""
    for src, dst in MERGE_HANDLES.items():
        if src not in families or src == dst:
            continue
        if dst not in families:
            families[dst] = families[src]
            families[dst].handle = dst
        else:
            families[dst].variants.update(families[src].variants)
            if families[src].source == "hisc" and families[dst].source != "hisc":
                families[dst].source = "hisc"
            for attr in ("title", "body_html", "image_src", "image_alt"):
                if not getattr(families[dst], attr) and getattr(families[src], attr):
                    setattr(families[dst], attr, getattr(families[src], attr))
        del families[src]
    return families


def ensure_family(
    families: dict[str, Family],
    handle: str,
    pdf: PdfSku,
    *,
    source: str,
) -> Family:
    if handle in families:
        return families[handle]
    title = family_title_from_name(pdf.name)
    families[handle] = Family(
        handle=handle,
        title=title,
        body_html=DEFAULT_BODY.format(title=title),
        tags="Attachment, cid-attachments",
        template_suffix="attachment",
        source=source,
    )
    return families[handle]


def build_catalog(
    pdf_skus: dict[str, PdfSku],
    hisc_path: Path,
    *,
    supabase_by_sku: dict[str, dict] | None = None,
) -> tuple[dict[str, Family], list[dict], dict[str, dict]]:
    sku_to_handle, families, sku_to_row = load_hisc(hisc_path)
    stem_pairs = build_stem_map(sku_to_handle)
    report: list[dict] = []

    for sku, pdf in sorted(pdf_skus.items()):
        if sku in sku_to_handle:
            handle = sku_to_handle[sku]
            source = "hisc"
        else:
            handle = infer_handle(sku, pdf.name, stem_pairs)
            source = "inferred" if handle in families else "new"
        fam = ensure_family(families, handle, pdf, source=source)
        hisc = sku_to_row.get(sku)
        opts = variant_options(sku, pdf.name, hisc)
        weight = pdf.weight_lbs
        if weight is None and hisc and (hisc.get("Variant Weight") or "").strip():
            try:
                weight = float(hisc["Variant Weight"])
            except ValueError:
                weight = None

        pricing = retail_pricing_from_cost(pdf.dealer)
        if not pricing:
            continue
        cost_s, price_s, compare_s = pricing
        fam.variants[sku] = {
            **opts,
            "Variant SKU": sku,
            "Variant Price": price_s,
            "Variant Compare At Price": compare_s,
            "Variant Cost": cost_s,
            "Variant Weight": str(int(weight)) if weight and weight == int(weight) else (str(weight) if weight else ""),
            "Variant Weight Unit": "lb" if weight else "",
            "Variant Inventory Policy": "continue",
            "Variant Inventory Tracker": "",
            "Variant Fulfillment Service": "manual",
            "Variant Requires Shipping": "True",
            "Variant Taxable": "True",
            "_pdf_name": pdf.name,
            "_source": source,
        }
        report.append(
            {
                "sku": sku,
                "handle": handle,
                "family_source": fam.source,
                "variant_source": source,
                "pdf_name": pdf.name,
                "retail": pdf.retail,
                "dealer": pdf.dealer,
            }
        )

    merge_families(families)
    finalize_family_metadata(families, pdf_skus, supabase_by_sku or {})
    # Refresh handles in report after merge
    handle_by_sku = {sku: h for h, fam in families.items() for sku in fam.variants}
    for row in report:
        row["handle"] = handle_by_sku.get(row["sku"], row["handle"])

    return families, report, sku_to_row


def collect_family_gallery_urls(
    fam: Family,
    sku_to_hisc_row: dict[str, dict],
    import_build_by_sku: dict[str, dict],
) -> list[str]:
    """Unique gallery URLs: hero, HISC positions, then cid_import_build.image_file."""
    seen: set[str] = set()
    urls: list[str] = []

    def add(url: str | None) -> None:
        u = (url or "").strip()
        if u and u not in seen:
            seen.add(u)
            urls.append(u)

    add(fam.image_src)

    hisc_imgs: list[tuple[int, str]] = []
    for sku in fam.variants:
        row = sku_to_hisc_row.get(sku)
        if not row:
            continue
        img = (row.get("Image Src") or "").strip()
        if not img:
            continue
        try:
            pos = int(row.get("Image Position") or 99)
        except ValueError:
            pos = 99
        hisc_imgs.append((pos, img))
    for _, img in sorted(hisc_imgs, key=lambda x: (x[0], x[1])):
        add(img)

    for sku in sorted(fam.variants):
        row = import_build_by_sku.get(sku.upper())
        if row:
            add(row.get("image_file"))

    return urls


def matrixify_image_row(handle: str, url: str, position: int, alt: str) -> dict[str, str]:
    row = {col: "" for col in MATRIXIFY_COLUMNS}
    row["Handle"] = handle
    row["Image Src"] = url
    row["Image Position"] = str(position)
    row["Image Alt Text"] = alt
    return row


def matrixify_rows(
    families: dict[str, Family],
    family_specs: dict[str, dict] | None = None,
    import_build_by_sku: dict[str, dict] | None = None,
    sku_to_hisc_row: dict[str, dict] | None = None,
) -> tuple[list[dict[str, str]], int]:
    family_specs = family_specs or {}
    import_build_by_sku = import_build_by_sku or {}
    sku_to_hisc_row = sku_to_hisc_row or {}
    rows: list[dict[str, str]] = []
    gallery_extra_rows = 0
    for handle in sorted(families):
        fam = families[handle]
        if not fam.variants:
            continue
        first = True
        gallery = collect_family_gallery_urls(fam, sku_to_hisc_row, import_build_by_sku)
        image_alt = fam.image_alt or fam.title
        for sku in sorted(fam.variants):
            v = fam.variants[sku]
            row = {col: "" for col in MATRIXIFY_COLUMNS}
            row["Handle"] = handle
            if first:
                row["Command"] = "MERGE"
                row["Title"] = fam.title
                row["Body HTML"] = fam.body_html
                row["Vendor"] = fam.vendor
                row["Type"] = fam.product_type
                row["Tags"] = fam.tags
                row["Status"] = "Active" if fam.status.lower() == "active" else fam.status
                row["Published"] = fam.published
                row["Published Scope"] = "web"
                row["Template Suffix"] = fam.template_suffix
                row["Top Row"] = "TRUE"
                if gallery:
                    row["Image Src"] = gallery[0]
                    row["Image Position"] = "1"
                    row["Image Alt Text"] = image_alt
                elif fam.image_src:
                    row["Image Src"] = fam.image_src
                    row["Image Position"] = "1"
                    row["Image Alt Text"] = image_alt
                first = False
            for k in (
                "Option1 Name",
                "Option1 Value",
                "Option2 Name",
                "Option2 Value",
                "Option3 Name",
                "Option3 Value",
                "Variant SKU",
                "Variant Price",
                "Variant Compare At Price",
                "Variant Cost",
                "Variant Weight",
                "Variant Weight Unit",
                "Variant Inventory Policy",
                "Variant Inventory Tracker",
                "Variant Fulfillment Service",
                "Variant Requires Shipping",
                "Variant Taxable",
            ):
                if k in v:
                    row[k] = v[k]
            payload = family_specs.get(handle)
            import_row = import_build_by_sku.get(sku.upper())
            has_import_specs = import_row and _import_build_specs_populated(import_row.get("specs"))
            if payload or has_import_specs:
                row["Variant Metafield: custom.attachment_specs [json]"] = build_attachment_specs_json(
                    fam, sku, v, payload, import_row
                )
            rows.append(row)
        for pos, url in enumerate(gallery[1:], start=2):
            rows.append(matrixify_image_row(handle, url, pos, image_alt))
            gallery_extra_rows += 1
    return rows, gallery_extra_rows


def main() -> int:
    ap = argparse.ArgumentParser(description="Build CID attachments Matrixify from PDF + HISC")
    ap.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    ap.add_argument("--hisc", type=Path, default=DEFAULT_HISC)
    ap.add_argument("--out", type=Path, default=OUTPUT_CSV)
    ap.add_argument("--report", type=Path, default=REPORT_CSV)
    ap.add_argument("--no-supabase", action="store_true", help="Skip Supabase attachment_catalog enrichment")
    args = ap.parse_args()

    if not args.pdf.is_file():
        print(f"Missing PDF: {args.pdf}", file=sys.stderr)
        return 1
    if not args.hisc.is_file():
        print(f"Missing HISC: {args.hisc}", file=sys.stderr)
        return 1

    pdf_skus = parse_pdf(args.pdf)
    supa = {} if args.no_supabase else load_supabase_attachments()
    import_build = {} if args.no_supabase else load_cid_import_build()
    family_specs = load_attachment_family_specs()
    families, report, sku_to_hisc = build_catalog(pdf_skus, args.hisc, supabase_by_sku=supa)
    apply_family_enrichment(families, family_specs)
    rows, gallery_extra_rows = matrixify_rows(
        families, family_specs, import_build, sku_to_hisc
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=MATRIXIFY_COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    with args.report.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["sku", "handle", "family_source", "variant_source", "pdf_name", "retail", "dealer"],
        )
        w.writeheader()
        w.writerows(report)

    n_var = len(report)
    n_fam = len([f for f in families.values() if f.variants])
    hisc_var = sum(1 for r in report if r["variant_source"] == "hisc")
    new_fam = sum(1 for f in families.values() if f.source != "hisc" and f.variants)
    print(f"PDF SKUs:     {len(pdf_skus)}")
    print(f"Families:     {n_fam}")
    print(f"Variants:     {n_var}")
    print(f"  from HISC:  {hisc_var}")
    print(f"  inferred:   {n_var - hisc_var}")
    print(f"Wrote {args.out} ({len(rows)} Matrixify rows)")
    print(f"Wrote {args.report}")
    spec_rows = sum(1 for r in rows if r.get("Variant Metafield: custom.attachment_specs [json]"))
    import_spec_skus = sum(
        1
        for r in report
        if _import_build_specs_populated((import_build.get((r.get("sku") or "").upper()) or {}).get("specs"))
    )
    print(
        f"  attachment_specs rows: {spec_rows} "
        f"({len(family_specs)} family JSON, {import_spec_skus} cid_import_build SKUs)"
    )
    families_with_gallery = sum(
        1
        for h in families
        if len(collect_family_gallery_urls(families[h], sku_to_hisc, import_build)) > 1
    )
    print(f"  gallery image rows: {gallery_extra_rows} ({families_with_gallery} families with 2+ images)")
    print("Matrixify: MERGE | Match: Handle | Enable: Products, Variants, Images, Metafields")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
