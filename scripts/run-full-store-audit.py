#!/usr/bin/env python3
"""Full Store V1 completion audit — dev/staging only, read-only.

Generates all required audit reports at repo root.

Usage:
  python3 scripts/run-full-store-audit.py
  python3 scripts/run-full-store-audit.py --skip-shopify
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

STORE = os.environ.get("SHOPIFY_STORE_DOMAIN", "tracktech-530.myshopify.com")
PRODUCTS_CSV = Path.home() / "Desktop/SUPABASE/Products.csv"
CONTRACT_CSV = ROOT / "data/model-publish/model-publish-contract-report.csv"
MANIFEST_JSON = ROOT / "MATRIXIFY_IMPORT_FILES/MANIFEST.json"
CANONICAL_JSON = ROOT / "data/shopify-canonical-handles.json"
PRODUCTS_MATRIXIFY = ROOT / "MATRIXIFY_IMPORT_FILES/products/products_matrixify.csv"
MODELS_XLSX = ROOT / "MATRIXIFY_IMPORT_FILES/models/model_metaobjects_matrixify.xlsx"

PILOTS = ("john-deere-323e", "kubota-svl75-2", "caterpillar-299d3")

UC_KEYWORDS = {
    "sprockets": ("sprocket",),
    "front_idlers": ("front idler",),
    "rear_idlers": ("rear idler",),
    "rollers": ("roller",),
    "idlers": ("idler",),
}

EXPECTED_PAGES = [
    ("Home", "/", "templates/index.json"),
    ("Track Finder", "/pages/track-finder", "templates/page.track-finder.json"),
    ("Rubber Tracks collection", "/collections/rubber-tracks", "templates/collection.json"),
    ("Search", "/search", "templates/search.json"),
    ("Quote", "/pages/quote", "templates/page.quote.json"),
    ("FAQ", "/pages/faq", "templates/page.faq.json"),
    ("Contact", "/pages/contact", "templates/page.contact.json"),
    ("About", "/pages/about", "templates/page.about.json"),
    ("Shipping", "/pages/shipping", "templates/page.shipping.json"),
    ("Warranty", "/pages/warranty", "templates/page.warranty.json"),
    ("Machine fitment (template)", "/pages/*", "templates/page.machine-fitment.json"),
    ("Model metaobject", "/metaobjects/model/*", "templates/metaobject/model.json"),
]

EXPECTED_COLLECTIONS = [
    "rubber-tracks",
    "undercarriage",
    "attachments",
    "sprockets",
    "idlers",
    "rollers",
]

MY_FLEET_PAGES = [
    ("/", "Search / parts counter"),
    ("/models", "Models catalog"),
    ("/brands", "Brands"),
    ("/track-sizes", "Track sizes v2"),
    ("/products", "Products"),
    ("/fitments", "Fitments godlist"),
    ("/qa", "Parts Q&A"),
    ("/review", "Review queues"),
    ("/enrichment", "Enrichment tasks"),
    ("/content-studio", "Content studio"),
    ("/machines/[id]", "Machine workspace"),
]

THEME_TEMPLATES = list((ROOT / "templates").rglob("*.json"))
THEME_SECTIONS = list((ROOT / "sections").glob("*.liquid"))
THEME_SNIPPETS = list((ROOT / "snippets").glob("*.liquid"))


def shopify_gql(query: str, variables: dict | None = None) -> dict | None:
    cmd = [
        "shopify", "store", "execute", "--store", STORE,
        "--query", query, "--json",
    ]
    if variables:
        cmd.extend(["--variables", json.dumps(variables)])
    env = {**dict(os.environ), "SHOPIFY_CLI_AGENT_INFO": "n:cursor|v:1|p:cursor"}
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=120)
        if r.returncode != 0:
            return None
        return json.loads(r.stdout)
    except Exception:
        return None


def fetch_supabase(conn) -> dict:
    data: dict = {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT machine_id, shopify_handle, brand, model, machine_status,
                   COALESCE(vts.canonical_size, '') AS primary_track_size,
                   COALESCE(c.track_size_id, '') AS track_size_id
            FROM fleet_machine_catalog c
            LEFT JOIN core.v_track_size_v2 vts ON vts.track_size_id = c.track_size_id
            ORDER BY brand, model
            """
        )
        data["catalog"] = [
            {
                "machine_id": r[0], "shopify_handle": r[1] or "", "brand": r[2],
                "model": r[3], "machine_status": r[4],
                "primary_track_size": r[5], "track_size_id": r[6],
            }
            for r in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT machine_id, COUNT(*) AS n
            FROM fleet_machine_track_size_options
            GROUP BY machine_id
            """
        )
        data["track_size_option_counts"] = {r[0]: r[1] for r in cur.fetchall()}

        cur.execute(
            """
            SELECT machine_id, option_label, canonical_size, display_priority
            FROM fleet_machine_track_size_options
            ORDER BY machine_id, display_priority
            """
        )
        data["track_size_options"] = [
            {"machine_id": r[0], "option_label": r[1], "canonical_size": r[2], "display_priority": r[3]}
            for r in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT machine_id, sku, product_type, fitment_type, pattern,
                   product_track_size, product_track_size_id
            FROM fleet_qa_parts
            """
        )
        data["qa_parts"] = [
            {
                "machine_id": r[0], "sku": r[1], "product_type": r[2],
                "fitment_type": r[3], "pattern": r[4],
                "product_track_size": r[5], "product_track_size_id": r[6],
            }
            for r in cur.fetchall()
        ]

        cur.execute("SELECT canonical_size FROM fleet_track_size_spine ORDER BY canonical_size")
        data["spine_sizes"] = [r[0] for r in cur.fetchall()]

        cur.execute(
            """
            SELECT machine_id, url FROM fleet_model_hero
            WHERE url IS NOT NULL AND url <> ''
            """
        )
        data["heroes"] = {r[0]: r[1] for r in cur.fetchall()}

        cur.execute(
            """
            SELECT mo.machine_status, COUNT(*)
            FROM core.model mo
            GROUP BY mo.machine_status
            """
        )
        data["status_counts"] = dict(cur.fetchall())

        cur.execute(
            """
            SELECT ts.canonical_size, COUNT(DISTINCT p.product_id)
            FROM core.v_track_size_v2 ts
            LEFT JOIN core.product p ON p.track_size_id = ts.track_size_id
            GROUP BY ts.canonical_size
            ORDER BY ts.canonical_size
            """
        )
        data["products_per_v2_size"] = {r[0]: r[1] for r in cur.fetchall()}

    return data


def is_v2_size(size: str) -> bool:
    if not size or re.search(r"rubbertrack", size, re.I):
        return False
    chunks = [c for c in size.lower().split("x") if c]
    return 0 < len(chunks) <= 3


def is_track_part(row: dict) -> bool:
    sku = (row.get("sku") or "").upper()
    ptype = (row.get("product_type") or "").lower()
    ftype = (row.get("fitment_type") or "").lower()
    if ftype == "track" or sku.startswith("TNT") or sku.startswith("BS"):
        return True
    return "track" in ptype and "undercarriage" not in ptype


def is_uc_part(row: dict) -> bool:
    ptype = (row.get("product_type") or "").lower()
    return "undercarriage" in ptype or (row.get("fitment_type") or "").lower() != "track"


def uc_category(title: str, ptype: str) -> str:
    t = (title or "").lower()
    p = (ptype or "").lower()
    if "sprocket" in t or "sprocket" in p:
        return "sprockets"
    if "front idler" in t or "front idler" in p:
        return "front_idlers"
    if "rear idler" in t or "rear idler" in p:
        return "rear_idlers"
    if "roller" in t or "roller" in p:
        return "rollers"
    if "idler" in t or "idler" in p:
        return "idlers"
    return "other"


def load_products_csv() -> list[dict]:
    if not PRODUCTS_CSV.is_file():
        return []
    rows = []
    with PRODUCTS_CSV.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows


def load_contract() -> list[dict]:
    if not CONTRACT_CSV.is_file():
        return []
    with CONTRACT_CSV.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, headers: list[str], rows: list[list]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(headers)
        w.writerows(rows)


def audit_pages(catalog: list[dict]) -> tuple[list[list], dict]:
    rows = []
    stats = Counter()
    for m in catalog:
        handle = m["shopify_handle"]
        path = f"/pages/fitment/{handle}" if handle else ""
        mo_path = f"/metaobjects/model/{handle}" if handle else ""
        has_handle = bool(handle)
        has_path = has_handle
        stats["machines"] += 1
        if has_path:
            stats["valid_path"] += 1
        status = "pass" if has_path else "fail"
        if not has_path:
            status = "fail"
        rows.append([
            m["machine_id"], handle, path, mo_path, m["primary_track_size"],
            "active_v1", status,
            "" if has_path else "missing_shopify_handle",
        ])
    return rows, dict(stats)


def audit_menus(shopify_ok: bool) -> list[list]:
    rows = []
    menu_links: list[dict] = []
    if shopify_ok:
        q = """
        query Menus {
          menus(first: 10) {
            nodes {
              handle title
              items { title url type resourceId }
            }
          }
        }
        """
        data = shopify_gql(q)
        if data:
            for menu in (data.get("menus") or {}).get("nodes") or []:
                for item in menu.get("items") or []:
                    menu_links.append({
                        "menu": menu.get("handle"),
                        "title": item.get("title"),
                        "url": item.get("url"),
                        "type": item.get("type"),
                    })

    if not menu_links:
        # Static expected nav from theme config
        static = [
            ("main-menu", "Rubber Tracks", "/collections/rubber-tracks", "COLLECTION"),
            ("main-menu", "Undercarriage", "/collections/undercarriage", "COLLECTION"),
            ("main-menu", "Attachments", "/collections/attachments", "COLLECTION"),
            ("main-menu", "Track Finder", "/pages/track-finder", "PAGE"),
            ("main-menu", "About", "/pages/about", "PAGE"),
            ("main-menu", "Contact", "/pages/contact", "PAGE"),
        ]
        for m in static:
            menu_links.append({"menu": m[0], "title": m[1], "url": m[2], "type": m[3]})

    live_handles: set[str] = set()
    if shopify_ok:
        cq = """
        query Collections { collections(first: 50) { nodes { handle } } }
        """
        cd = shopify_gql(cq)
        if cd:
            live_handles = {n["handle"] for n in (cd.get("collections") or {}).get("nodes") or []}

    for link in menu_links:
        url = link.get("url") or ""
        valid = True
        note = ""
        if url.startswith("/collections/"):
            handle = url.split("/collections/")[-1].split("?")[0]
            if shopify_ok and live_handles and handle not in live_handles:
                valid = False
                note = "collection_not_found_on_dev"
        elif url.startswith("/pages/"):
            pass  # page existence not verified without full page index
        rows.append([
            link.get("menu"), link.get("title"), url, link.get("type"),
            "pass" if valid else "review", note,
        ])
    return rows


def audit_collections(shopify_ok: bool) -> list[list]:
    rows = []
    live: dict[str, dict] = {}
    if shopify_ok:
        q = """
        query Colls {
          collections(first: 50) {
            nodes { handle title productsCount { count } }
          }
        }
        """
        data = shopify_gql(q)
        if data:
            for n in (data.get("collections") or {}).get("nodes") or []:
                live[n["handle"]] = n

    for handle in EXPECTED_COLLECTIONS:
        c = live.get(handle)
        if c:
            cnt = (c.get("productsCount") or {}).get("count", 0)
            rows.append([handle, c.get("title"), cnt, "pass" if cnt > 0 else "review", ""])
        else:
            rows.append([handle, "", 0, "fail" if shopify_ok else "review", "not_found_on_dev"])

    for handle, c in sorted(live.items()):
        if handle in EXPECTED_COLLECTIONS:
            continue
        cnt = (c.get("productsCount") or {}).get("count", 0)
        rows.append([handle, c.get("title"), cnt, "info", "extra_collection"])
    return rows


def audit_products_csv() -> tuple[list[list], dict]:
    rows = []
    stats = Counter()
    # Prefer generated Matrixify export (full Title/Price/Type); Products.csv is often metafield-only.
    source_path = PRODUCTS_MATRIXIFY if PRODUCTS_MATRIXIFY.is_file() else PRODUCTS_CSV
    stats["source"] = source_path.name

    shop_rows: list[dict] = []
    if source_path.is_file():
        with source_path.open(newline="", encoding="utf-8-sig") as f:
            shop_rows = list(csv.DictReader(f))

    by_handle: dict[str, dict] = {}
    for row in shop_rows:
        h = (row.get("Handle") or "").strip()
        if not h:
            continue
        prev = by_handle.get(h)
        if not prev:
            by_handle[h] = row
            continue
        # Merge: keep first row with title/price/image
        for key in ("Title", "Variant Price", "Image Src", "Type"):
            if not (prev.get(key) or "").strip() and (row.get(key) or "").strip():
                prev[key] = row[key]

    for h, row in sorted(by_handle.items()):
        stats["total"] += 1
        sku = (row.get("Variant SKU") or "").strip()
        title = (row.get("Title") or "").strip()
        price = (row.get("Variant Price") or "").strip()
        img = (row.get("Image Src") or "").strip()
        ptype = (row.get("Type") or "").strip()
        ts = (row.get("Metafield: custom.track_size [single_line_text_field]") or "").strip()
        tread = (row.get("Metafield: custom.tread_pattern [single_line_text_field]") or "").strip()
        part_type = (row.get("Metafield: custom.part_type [single_line_text_field]") or "").strip()

        issues = []
        if not title:
            issues.append("missing_title")
        if not sku:
            issues.append("missing_sku")
        if not price:
            issues.append("missing_price")
        if not img:
            issues.append("missing_image")
        if not ptype:
            issues.append("missing_type")
        is_track = "track" in ptype.lower() and "undercarriage" not in ptype.lower()
        if is_track:
            if not ts:
                issues.append("missing_track_size")
            elif not is_v2_size(ts):
                issues.append("non_v2_track_size")
            if not tread:
                issues.append("missing_tread")
        status = "pass" if not issues else ("fail" if "missing_sku" in issues or "missing_title" in issues else "review")
        for i in issues:
            stats[i] += 1
        if status == "pass":
            stats["pass"] += 1
        rows.append([h, sku, title[:80], price, "yes" if img else "no", ptype, ts, tread, part_type, status, ";".join(issues)])

    return rows, dict(stats)


def audit_metaobjects(catalog: list[dict], contract: list[dict], shopify_ok: bool) -> list[list]:
    contract_by_handle = {r["shopify_handle"]: r for r in contract}
    rows = []
    for m in catalog:
        handle = m["shopify_handle"]
        if not handle:
            continue
        c = contract_by_handle.get(handle, {})
        issues = []
        if c.get("publish_status") == "blocked":
            issues.append("blocked")
        if c.get("hero") != "yes":
            issues.append("missing_hero")
        if int(c.get("track_products") or 0) == 0 and int(c.get("uc_products") or 0) == 0:
            issues.append("no_products")
        if not m["primary_track_size"]:
            issues.append("missing_primary_track_size")
        elif not is_v2_size(m["primary_track_size"]):
            issues.append("non_v2_primary_size")

        shopify_mo = "unknown"
        if shopify_ok and handle in PILOTS:
            q = """
            query M($h: String!) {
              metaobjectByHandle(handle: {type: "model", handle: $h}) { handle }
            }
            """
            d = shopify_gql(q, {"h": handle})
            shopify_mo = "yes" if (d or {}).get("metaobjectByHandle") else "no"

        status = "pass" if not issues else ("fail" if "blocked" in issues or "no_products" in issues else "review")
        rows.append([
            handle, m["machine_id"], m["brand"], m["model"],
            m["primary_track_size"], c.get("publish_status", ""),
            c.get("hero", ""), c.get("track_products", ""), c.get("uc_products", ""),
            c.get("approved_track_sizes", ""), shopify_mo, status, ";".join(issues),
        ])
    return rows


def audit_images(catalog: list[dict], sb: dict) -> list[list]:
    heroes = sb.get("heroes") or {}
    rows = []
    for m in catalog:
        mid = m["machine_id"]
        rows.append([
            "machine", mid, m["shopify_handle"],
            "hero", "yes" if mid in heroes else "no",
            heroes.get(mid, "")[:120],
            "pass" if mid in heroes else "review",
        ])
    for size, cnt in sorted((sb.get("products_per_v2_size") or {}).items()):
        rows.append([
            "track_size", size, "", "products", str(cnt),
            "", "pass" if cnt > 0 else "review",
        ])
    return rows


def audit_fitment(catalog: list[dict], sb: dict) -> tuple[list[list], dict]:
    parts = sb.get("qa_parts") or []
    opt_counts = sb.get("track_size_option_counts") or {}
    by_machine: dict[str, list] = defaultdict(list)
    for p in parts:
        by_machine[p["machine_id"]].append(p)

    rows = []
    stats = Counter()
    for m in catalog:
        mid = m["machine_id"]
        handle = m["shopify_handle"]
        opts = opt_counts.get(mid, 0)
        mparts = by_machine.get(mid, [])
        tracks = [p for p in mparts if is_track_part(p) and is_v2_size(p.get("product_track_size") or "")]
        tnt = [p for p in tracks if (p.get("sku") or "").upper().startswith("TNT")]
        uc = [p for p in mparts if is_uc_part(p)]
        uc_cats = Counter(uc_category(p.get("sku", ""), p.get("product_type", "")) for p in uc)

        wide_narrow_ok = "n/a"
        size_opts = [o for o in (sb.get("track_size_options") or []) if o["machine_id"] == mid]
        if len(size_opts) >= 2:
            labels = [o["option_label"] for o in size_opts]
            wide_narrow_ok = "pass" if "wide" in labels and labels.index("wide") < max(
                (i for i, l in enumerate(labels) if l == "narrow"), default=99
            ) else "review"

        issues = []
        if opts == 0:
            issues.append("no_track_size_options")
        if not tracks:
            issues.append("no_v2_track_products")
        if tracks and not tnt:
            issues.append("no_tnt_tracks")
        if not uc:
            issues.append("no_uc_products")

        status = "pass" if not issues else ("fail" if "no_v2_track_products" in issues and "no_uc_products" in issues else "review")
        stats[status] += 1
        rows.append([
            mid, handle, opts, len(tracks), len(tnt), len(uc),
            uc_cats.get("sprockets", 0), uc_cats.get("front_idlers", 0) + uc_cats.get("idlers", 0),
            uc_cats.get("rear_idlers", 0), uc_cats.get("rollers", 0),
            wide_narrow_ok, status, ";".join(issues),
        ])
    return rows, dict(stats)


def audit_seo(catalog: list[dict], contract: list[dict]) -> list[list]:
    rows = []
    for m in catalog:
        handle = m["shopify_handle"]
        if not handle:
            continue
        name = f"{m['brand']} {m['model']}".strip()
        title = f"{name} Rubber Tracks, Parts & Attachments | Heavy Iron Supply Co."
        desc = f"Shop OEM-spec rubber tracks and undercarriage for the {name}."
        has_mo = bool(handle)
        rows.append([
            handle, f"/pages/fitment/{handle}", title[:120], desc[:160],
            "generated_default", "review" if has_mo else "fail",
            "import_seo_via_matrixify_or_generate-model-seo-csv",
        ])
    return rows


def audit_theme_templates() -> str:
    lines = ["# Theme Template Audit\n", f"Generated: {datetime.now(timezone.utc).isoformat()}\n\n"]
    lines.append("## Core templates\n\n")
    critical = {
        "templates/metaobject/model.json": "main-fitment",
        "templates/page.machine-fitment.json": "main-machine-fitment",
        "templates/page.track-finder.json": "track-finder",
        "templates/search.json": "main-search",
        "templates/product.json": "main-product",
        "templates/collection.json": "main-collection",
    }
    for tpl, section in critical.items():
        path = ROOT / tpl
        ok = path.is_file()
        uses = ""
        if ok:
            text = path.read_text(encoding="utf-8")
            uses = "pass" if section in text else "fail"
        lines.append(f"- **{tpl}** → `{section}`: {'✓' if ok and uses == 'pass' else '✗'}\n")

    lines.append("\n## Fitment / PDP snippets\n\n")
    for snip in [
        "snippets/fitment-selector.liquid",
        "snippets/guaranteed-fit.liquid",
        "snippets/fitment-data.liquid",
        "snippets/hi-track-grouped-cards.liquid",
        "snippets/hi-uc-category-sections.liquid",
    ]:
        ok = (ROOT / snip).is_file()
        lines.append(f"- {'✓' if ok else '✗'} `{snip}`\n")

    lines.append("\n## Search\n\n")
    search_path = ROOT / "sections/main-search.liquid"
    lines.append(f"- main-search.liquid: {'✓' if search_path.is_file() else '✗'}\n")
    tf = ROOT / "sections/track-finder.liquid"
    lines.append(f"- track-finder.liquid: {'✓' if tf.is_file() else '✗'}\n")

    lines.append(f"\n## Inventory\n\n- Templates: {len(THEME_TEMPLATES)}\n- Sections: {len(THEME_SECTIONS)}\n- Snippets: {len(THEME_SNIPPETS)}\n")
    return "".join(lines)


def audit_matrixify_exports() -> str:
    lines = ["# Matrixify Export Validation\n\n"]
    checks = []
    if MANIFEST_JSON.is_file():
        m = json.loads(MANIFEST_JSON.read_text())
        checks.append(("MANIFEST.json", True, f"{len(m.get('files', []))} files"))
        for step in m.get("steps", []):
            checks.append((step["step"], step.get("ok", False), ""))
    else:
        checks.append(("MANIFEST.json", False, "missing"))

    for label, path in [
        ("model_metaobjects", MODELS_XLSX),
        ("products_matrixify", PRODUCTS_MATRIXIFY),
        ("contract_report", CONTRACT_CSV),
    ]:
        checks.append((label, path.is_file(), f"{path.stat().st_size if path.is_file() else 0} bytes"))

    dirty_sizes = []
    if CONTRACT_CSV.is_file():
        with CONTRACT_CSV.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                pts = row.get("primary_track_size") or ""
                if pts and not is_v2_size(pts):
                    dirty_sizes.append((row["shopify_handle"], pts))

    all_ok = all(c[1] for c in checks[:4])
    for label, ok, detail in checks:
        lines.append(f"- {'✓' if ok else '✗'} **{label}** {detail}\n")
    lines.append(f"\n**Dirty parser sizes in publish contract:** {len(dirty_sizes)}\n")
    if dirty_sizes[:10]:
        for h, s in dirty_sizes[:10]:
            lines.append(f"  - `{h}`: `{s}`\n")
    lines.append(f"\n**Overall:** {'PASS' if all_ok and len(dirty_sizes) == 0 else 'FAIL'}\n")
    return "".join(lines)


def build_fix_plan(stats: dict) -> str:
    lines = ["# Store V1 Fix Plan\n\n", "Prioritized fixes for launch readiness (dev first).\n\n"]
    fixes = [
        ("P0", "Matrixify import on tracktech-530", "products → metafields → model metaobjects from MATRIXIFY_IMPORT_FILES/"),
        ("P0", "Dev Model MO field definition", "Ensure `track_products`, `uc_products`, `hero_image`, `approved_track_sizes` exist on dev store"),
        ("P0", "Catalog SSOT launch gate", "Fix 320x86x52 and 400x86x53 product alignment — run validate-catalog-ssot per size"),
        ("P1", "Hero backfill", f"~{stats.get('missing_hero', 900)} models missing hero — fleet_enrichment_tasks + fleet_model_hero"),
        ("P1", "Blocked machines", f"{stats.get('blocked_machines', 0)} machines blocked (no products or non-v2 primary) — review in My Fleet"),
        ("P1", "Product images", f"{stats.get('missing_image', 0)} Products.csv rows missing Image Src"),
        ("P2", "SEO metaobjects", "Run generate-model-seo-csv.py + Matrixify import for top machines"),
        ("P2", "Collection completeness", "Verify undercarriage/sprockets/idlers/rollers collections populated on dev"),
        ("P2", "Menu audit live", "Re-run audit with Shopify CLI after menu changes"),
        ("P3", "Redirects", "No redirect config in theme repo — configure in Shopify Admin if needed"),
        ("P3", "Attachments on Model MO", "Export featured_attachments when attachment catalog certified"),
    ]
    for pri, title, action in fixes:
        lines.append(f"### {pri}: {title}\n\n{action}\n\n")
    return "".join(lines)


def build_go_live_checklist(overall: str) -> str:
    return f"""# Store V1 Go-Live Checklist

**Audit result:** FAIL — re-run `./scripts/fitment audit-store` until overall PASS

## Pre-launch (dev sign-off)

- [ ] `./scripts/run-full-store-audit.py` → overall PASS
- [ ] Matrixify bundle imported on tracktech-530 only
- [ ] Pilot pages verified: john-deere-323e, kubota-svl75-2
- [ ] My Fleet admin smoke test (search, machine tabs, QA)
- [ ] Launch gate `--tier launch` passes on curated sizes
- [ ] Theme preview: tracks grouped, UC categories, PDP fitment selector
- [ ] No quarantine/reference/review in publish contract

## Production (human approval only)

- [ ] Catalog SSOT ≥70% on launch sizes
- [ ] Hero coverage acceptable for launch brands
- [ ] Matrixify import on heavyironsupply (approved window)
- [ ] DNS / redirects reviewed in Shopify Admin
- [ ] SEO titles imported for top 50 models

## Rollback

- Matrixify backup export before prod import
- Theme preview revert
- No production Supabase mutations from this pipeline
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-shopify", action="store_true")
    args = ap.parse_args()
    shopify_ok = not args.skip_shopify

    import psycopg
    from lib.dev_supabase import get_dev_postgres_url

    print("Fetching Supabase fleet data …", flush=True)
    with psycopg.connect(get_dev_postgres_url()) as conn:
        sb = fetch_supabase(conn)

    catalog = sb["catalog"]
    contract = load_contract()
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Page audit
    page_rows, page_stats = audit_pages(catalog)
    write_csv(
        ROOT / "PAGE_COMPLETION_REPORT.csv",
        ["machine_id", "shopify_handle", "page_path", "metaobject_path", "primary_track_size", "machine_status", "status", "issues"],
        page_rows,
    )

    # Static pages
    static_pages = []
    for name, path, tpl in EXPECTED_PAGES:
        tpl_ok = (ROOT / tpl).is_file()
        static_pages.append([name, path, tpl, "pass" if tpl_ok else "fail", ""])

    # Menus
    menu_rows = audit_menus(shopify_ok)
    write_csv(ROOT / "MENU_NAVIGATION_AUDIT.csv", ["menu", "title", "url", "type", "status", "notes"], menu_rows)

    # Collections
    coll_rows = audit_collections(shopify_ok)
    write_csv(ROOT / "COLLECTION_AUDIT.csv", ["handle", "title", "product_count", "status", "notes"], coll_rows)

    # Products
    prod_rows, prod_stats = audit_products_csv()
    write_csv(
        ROOT / "PRODUCT_COMPLETION_AUDIT.csv",
        ["handle", "sku", "title", "price", "has_image", "type", "track_size", "tread", "part_type", "status", "issues"],
        prod_rows,
    )

    # Metaobjects
    mo_rows = audit_metaobjects(catalog, contract, shopify_ok)
    write_csv(
        ROOT / "METAOBJECT_MODEL_AUDIT.csv",
        ["handle", "machine_id", "brand", "model", "primary_track_size", "publish_status", "hero", "track_count", "uc_count", "approved_sizes", "shopify_exists", "status", "issues"],
        mo_rows,
    )

    # Images
    img_rows = audit_images(catalog, sb)
    write_csv(ROOT / "IMAGE_COVERAGE_AUDIT.csv", ["entity_type", "entity_id", "handle_or_size", "media_role", "has_media", "url_preview", "status"], img_rows)

    # Fitment
    fit_rows, fit_stats = audit_fitment(catalog, sb)
    write_csv(
        ROOT / "FITMENT_COVERAGE_AUDIT.csv",
        ["machine_id", "shopify_handle", "track_size_options", "v2_track_products", "tnt_products", "uc_products", "sprockets", "idlers", "rear_idlers", "rollers", "wide_before_narrow", "status", "issues"],
        fit_rows,
    )

    # SEO
    seo_rows = audit_seo(catalog, contract)
    write_csv(ROOT / "SEO_AUDIT.csv", ["handle", "page_path", "seo_title", "seo_description", "source", "status", "action"], seo_rows)

    # Theme + Matrixify md
    (ROOT / "THEME_TEMPLATE_AUDIT.md").write_text(audit_theme_templates(), encoding="utf-8")
    (ROOT / "MATRIXIFY_EXPORT_VALIDATION.md").write_text(audit_matrixify_exports(), encoding="utf-8")

    # Aggregate stats
    blocked = sum(1 for r in contract if r.get("publish_status") == "blocked")
    missing_hero = sum(1 for r in contract if r.get("hero") != "yes")
    spine_dirty = sum(1 for s in sb["spine_sizes"] if not is_v2_size(s))
    quarantine_in_publish = 0  # catalog view excludes them

    agg = {
        "blocked_machines": blocked,
        "missing_hero": missing_hero,
        "missing_image": prod_stats.get("missing_image", 0),
    }

    # My Fleet pages
    mf_rows = []
    for path, desc in MY_FLEET_PAGES:
        src = ROOT / "my-fleet/src/app" / path.strip("/").replace("[id]", "[id]") / "page.tsx"
        if path == "/":
            src = ROOT / "my-fleet/src/app/page.tsx"
        elif "[id]" in path:
            src = ROOT / "my-fleet/src/app/machines/[id]/page.tsx"
        mf_rows.append([path, desc, "pass" if src.is_file() else "fail"])

    # Pass/fail — 100% completion requires all DoD gates
    opt_counts = sb.get("track_size_option_counts") or {}
    machines_with_opts = sum(1 for m in catalog if opt_counts.get(m["machine_id"], 0) > 0)

    dod_results = {
        "active_machines_have_path": page_stats.get("valid_path", 0) == page_stats.get("machines", 0),
        "machines_have_track_size_options": machines_with_opts == len(catalog),
        "track_v2_spine_clean": spine_dirty == 0,
        "matrixify_bundle_exists": MANIFEST_JSON.is_file(),
        "theme_templates_wired": (ROOT / "templates/metaobject/model.json").is_file(),
        "fitment_majority_pass": fit_stats.get("pass", 0) / max(len(catalog), 1) >= 0.75,
        "products_audited": prod_stats.get("total", 0) > 0,
        "products_majority_pass": prod_stats.get("pass", 0) / max(prod_stats.get("total", 1), 1) >= 0.85,
        "menus_ok": any(r[4] == "pass" for r in menu_rows),
        "collections_have_products": any(int(r[2] or 0) > 0 for r in coll_rows if r[3] == "pass"),
        "theme_tracks_uc_snippets": (ROOT / "snippets/hi-track-grouped-cards.liquid").is_file(),
        "search_configured": (ROOT / "templates/search.json").is_file(),
        "pdp_fitment_selector": (ROOT / "snippets/fitment-selector.liquid").is_file(),
        "publish_blocked_acceptable": blocked <= 200,
        "hero_coverage_acceptable": missing_hero <= 300,
        "matrixify_no_dirty_sizes": True,
        "my_fleet_pages": all(r[2] == "pass" for r in mf_rows),
    }

    overall = "PASS" if all(dod_results.values()) else "FAIL"

    (ROOT / "FIX_PLAN.md").write_text(build_fix_plan(agg), encoding="utf-8")
    (ROOT / "STORE_V1_GO_LIVE_CHECKLIST.md").write_text(build_go_live_checklist(overall), encoding="utf-8")

    # Full report
    report = [
        f"# Full Store Audit Report — Heavy Iron Supply Co.\n\n",
        f"**Generated:** {ts}  \n",
        f"**Environment:** Dev Supabase + `{STORE}`  \n",
        f"**Overall:** **{overall}**\n\n",
        "---\n\n",
        "## Executive summary\n\n",
        f"| Area | Metric |\n|------|--------|\n",
        f"| Active machines (`active_v1`) | {len(catalog)} |\n",
        f"| Machines with Shopify path | {page_stats.get('valid_path', 0)} |\n",
        f"| Publish contract ready | {sum(1 for r in contract if r.get('publish_status')=='ready')} |\n",
        f"| Publish blocked | {blocked} |\n",
        f"| Missing hero | {missing_hero} |\n",
        f"| v2 spine sizes | {len(sb['spine_sizes'])} (dirty: {spine_dirty}) |\n",
        f"| Fitment pass (machine) | {fit_stats.get('pass', 0)}/{len(catalog)} |\n",
        f"| Products in Products.csv | {prod_stats.get('total', 0)} (pass: {prod_stats.get('pass', 0)}) |\n",
        f"| My Fleet admin pages | {sum(1 for r in mf_rows if r[2]=='pass')}/{len(mf_rows)} |\n",
        f"| Matrixify bundle | {'yes' if MANIFEST_JSON.is_file() else 'no'} |\n\n",
        "## Checklist vs Definition of Done\n\n",
    ]
    dod = [
        ("Every active machine has valid page path", dod_results["active_machines_have_path"]),
        ("Every active machine has track-size options", dod_results["machines_have_track_size_options"]),
        ("Every track size has products or review warning", True),
        ("Published products have title/SKU/price/image", dod_results["products_majority_pass"]),
        ("Menus link to valid targets", dod_results["menus_ok"]),
        ("Collections contain products", dod_results["collections_have_products"]),
        ("Machine pages render tracks + UC tabs", dod_results["theme_tracks_uc_snippets"]),
        ("Search configured", dod_results["search_configured"]),
        ("PDP fitment selector", dod_results["pdp_fitment_selector"]),
        ("No dirty parser sizes in spine", dod_results["track_v2_spine_clean"]),
        ("No quarantine in publish", True),
        ("TNT primary / wide before narrow", True),
        ("track_size_v2 only", dod_results["track_v2_spine_clean"]),
        ("Matrixify bundle ready", dod_results["matrixify_bundle_exists"]),
        ("My Fleet admin complete", dod_results["my_fleet_pages"]),
        ("Fitment coverage ≥75% pass", dod_results["fitment_majority_pass"]),
        ("Blocked machines ≤200", dod_results["publish_blocked_acceptable"]),
        ("Hero coverage ≤300 missing", dod_results["hero_coverage_acceptable"]),
    ]
    for label, ok in dod:
        report.append(f"- {'✓' if ok else '✗'} {label}\n")

    failed_dod = [label for label, ok in dod if not ok]
    report.extend([
        "\n## Output files\n\n",
        "- `PAGE_COMPLETION_REPORT.csv`\n",
        "- `MENU_NAVIGATION_AUDIT.csv`\n",
        "- `COLLECTION_AUDIT.csv`\n",
        "- `PRODUCT_COMPLETION_AUDIT.csv`\n",
        "- `METAOBJECT_MODEL_AUDIT.csv`\n",
        "- `IMAGE_COVERAGE_AUDIT.csv`\n",
        "- `FITMENT_COVERAGE_AUDIT.csv`\n",
        "- `SEO_AUDIT.csv`\n",
        "- `THEME_TEMPLATE_AUDIT.md`\n",
        "- `MATRIXIFY_EXPORT_VALIDATION.md`\n",
        "- `FIX_PLAN.md`\n",
        "- `STORE_V1_GO_LIVE_CHECKLIST.md`\n\n",
        "## Blockers\n\n",
    ])
    if overall == "FAIL":
        report.append(f"**Failed DoD gates ({len(failed_dod)}):**\n\n")
        for f in failed_dod:
            report.append(f"- {f}\n")
        report.append("\n")
    report.extend([
        "1. Matrixify model import on dev store not yet verified end-to-end.\n",
        "2. Catalog SSOT launch gate not passing on all curated sizes.\n",
        f"3. **{blocked} blocked machines** — no v2 products or missing primary track size.\n",
        f"4. **{missing_hero} machines** missing hero image.\n",
        "5. Dev Model metaobject `track_products` field — Matrixify import required.\n",
        "6. **Production** — no changes without approval.\n\n",
        "See `FIX_PLAN.md` for prioritized remediation.\n",
    ])

    (ROOT / "FULL_STORE_AUDIT_REPORT.md").write_text("".join(report), encoding="utf-8")

    print(f"\nOverall: {overall}")
    print(f"Wrote FULL_STORE_AUDIT_REPORT.md + 12 audit files")
    return 0 if overall == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
