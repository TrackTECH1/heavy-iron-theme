#!/usr/bin/env python3
"""Cross-reference and validate catalog SSOT layer-by-layer.

Validates tracks grouped by track_size (one size bucket at a time), then UC/attachments.
Checks: TrackTech export ↔ Supabase ↔ canonical manifest ↔ live Shopify ↔ fitment ↔ variant bridge.

Usage:
  python3 scripts/validate-catalog-ssot.py
  python3 scripts/validate-catalog-ssot.py --track-size 450x86x58
  python3 scripts/validate-catalog-ssot.py --track-size 450x86x58 --verbose
  python3 scripts/validate-catalog-ssot.py --json data/catalog-validation-report.json
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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from lib.catalog_ssot import (  # noqa: E402
    iter_tracktech_export_rows,
    load_dotenv_fitment,
    normalize_track_size_for_images,
    supabase_get_all,
    supabase_key,
)

DEFAULT_TT = Path.home() / "Desktop/SUPABASE/tracktech-products-2026-06-21T22-38-21.xlsx"
DEFAULT_SHOP_CSV = Path.home() / "Desktop/SUPABASE/Products.csv"
MANIFEST = ROOT / "data" / "shopify-canonical-handles.json"
STORE = os.environ.get("SHOPIFY_STORE_DOMAIN", "tracktech-530.myshopify.com")

CHECKS = (
    "tracktech",
    "supabase_product",
    "handle_match",
    "canonical_manifest",
    "live_shopify",
    "fitment_rows",
    "variant_bridge",
)


def norm_size(raw: str | None) -> str:
    if not raw:
        return ""
    return normalize_track_size_for_images(str(raw).strip()) or str(raw).strip().lower()


def load_tracktech(path: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in iter_tracktech_export_rows(path):
        iid = str(row.get("itemid") or "").strip().upper()
        if not iid:
            continue
        fm = row.get("fitmentmodels") or row.get("fitment_models") or ""
        models = [t.strip() for t in str(fm).replace("|", ",").split(",") if t.strip()]
        ts = row.get("spec_track_size") or row.get("tracksize") or row.get("track_size")
        tread = row.get("trackpattern") or row.get("track_pattern") or row.get("tread")
        if iid not in out:
            out[iid] = {
                "track_size": str(ts).strip() if ts else "",
                "track_size_norm": norm_size(str(ts) if ts else ""),
                "tread": str(tread).strip() if tread else "",
                "models": models,
                "name": str(row.get("productname") or row.get("name") or "")[:60],
            }
    return out


def load_shop_csv(path: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not path.is_file():
        return out
    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            h = (row.get("Handle") or "").strip()
            iid = ""
            for k, v in row.items():
                if "tracktech_itemid" in k.lower() and (v or "").strip():
                    iid = v.strip().upper()
                    break
            if not iid:
                iid = (row.get("Variant SKU") or "").strip().upper()
            if not iid:
                continue
            ts = (row.get("Metafield: custom.track_size [single_line_text_field]") or "").strip()
            pt = (row.get("Metafield: custom.part_type [single_line_text_field]") or "").strip()
            tread = (row.get("Metafield: custom.tread_pattern [single_line_text_field]") or "").strip()
            if iid not in out:
                out[iid] = {
                    "handle": h,
                    "part_type": pt,
                    "track_size": ts,
                    "track_size_norm": norm_size(ts),
                    "tread": tread,
                }
    return out


def load_manifest() -> dict[str, dict]:
    if not MANIFEST.is_file():
        return {}
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return data.get("itemids") or {}


def live_shopify_index() -> dict[str, str]:
    """handle -> gid"""
    index: dict[str, str] = {}
    cursor = None
    q = """
    query($c:String){products(first:250,after:$c){pageInfo{hasNextPage endCursor}nodes{id handle}}}
    """
    while True:
        cmd = ["shopify", "store", "execute", "--store", STORE, "--query", q, "--json"]
        if cursor:
            cmd.extend(["--variables", json.dumps({"c": cursor})])
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError(r.stderr or r.stdout)
        data = json.loads(r.stdout)
        conn = data.get("products") or {}
        for n in conn.get("nodes") or []:
            h = (n.get("handle") or "").strip()
            gid = (n.get("id") or "").strip()
            if h and gid:
                index[h] = gid
        if not conn.get("pageInfo", {}).get("hasNextPage"):
            break
        cursor = conn["pageInfo"]["endCursor"]
    return index


def validate_itemid(
    iid: str,
    *,
    tt: dict,
    db: dict,
    shop: dict,
    manifest: dict,
    live_handles: dict[str, str],
    fitment_counts: dict[str, int],
    variant_map: set[str],
) -> dict:
    tt_row = tt.get(iid)
    db_row = db.get(iid)
    shop_row = shop.get(iid)
    man_row = manifest.get(iid) or {}

    canonical_handle = man_row.get("handle") or (shop_row or {}).get("handle") or (db_row or {}).get("handle") or ""
    db_handle = (db_row or {}).get("handle") or ""

    checks = {
        "tracktech": bool(tt_row),
        "supabase_product": bool(db_row),
        "handle_match": bool(db_row and canonical_handle and db_handle == canonical_handle),
        "canonical_manifest": iid in manifest,
        "live_shopify": bool(canonical_handle and canonical_handle in live_handles),
        "fitment_rows": fitment_counts.get(iid, 0) > 0,
        "variant_bridge": iid in variant_map,
    }
    score = sum(1 for v in checks.values() if v)
    issues = [k for k, v in checks.items() if not v]

    return {
        "itemid": iid,
        "track_size": (tt_row or {}).get("track_size") or (shop_row or {}).get("track_size") or (db_row or {}).get("track_size") or "",
        "tread": (tt_row or {}).get("tread") or (shop_row or {}).get("tread") or (db_row or {}).get("tread_pattern") or "",
        "canonical_handle": canonical_handle,
        "db_handle": db_handle,
        "fitment_models_tt": len((tt_row or {}).get("models") or []),
        "fitment_rows_db": fitment_counts.get(iid, 0),
        "checks": checks,
        "score": score,
        "max_score": len(CHECKS),
        "issues": issues,
        "ok": score == len(CHECKS),
    }


def print_size_report(size: str, items: list[dict], verbose: bool) -> None:
    ok = sum(1 for x in items if x["ok"])
    print(f"\n{'='*60}")
    print(f"TRACK SIZE: {size or '(unknown)'}  —  {ok}/{len(items)} fully valid")
    print(f"{'='*60}")
    issue_counts = Counter()
    for it in items:
        for iss in it["issues"]:
            issue_counts[iss] += 1
    if issue_counts:
        print("  Issues in bucket:")
        for k, n in issue_counts.most_common():
            print(f"    {k}: {n}/{len(items)}")

    failing = [x for x in items if not x["ok"]]
    failing.sort(key=lambda x: (x["score"], x["itemid"]))
    show = failing if verbose else failing[:8]
    for it in show:
        print(
            f"  [{it['score']}/{it['max_score']}] {it['itemid']:18} "
            f"{it.get('tread','')[:12]:12} issues={','.join(it['issues'])}"
        )
        if it["canonical_handle"]:
            print(f"           handle: {it['canonical_handle']}")
    if not verbose and len(failing) > len(show):
        print(f"  … +{len(failing) - len(show)} more failing (use --verbose)")


def main() -> int:
    load_dotenv_fitment()
    ap = argparse.ArgumentParser(description="Validate catalog SSOT cross-references")
    ap.add_argument("--tracktech", default=str(DEFAULT_TT))
    ap.add_argument("--shopify-csv", default=str(DEFAULT_SHOP_CSV))
    ap.add_argument("--track-size", help="Validate one normalized track size only (e.g. 450x86x58)")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--json", help="Write full report JSON path")
    args = ap.parse_args()

    if not supabase_key():
        print("Run ./scripts/fitment bootstrap", file=sys.stderr)
        return 1

    tt_path = Path(args.tracktech)
    print("Loading sources …", file=sys.stderr)
    tt = load_tracktech(tt_path)
    shop = load_shop_csv(Path(args.shopify_csv))
    manifest = load_manifest()

    db_rows = supabase_get_all(
        "product?select=product_code,handle,type,track_size,tread_pattern,shopify_product_id&source=eq.itemid_ssot"
    )
    db = {r["product_code"].upper(): r for r in db_rows if r.get("product_code")}

    fit_rows = supabase_get_all(
        "fitment?select=product:product_id(product_code)&source=eq.tracktech_export"
    )
    fit_counts: Counter[str] = Counter()
    for r in fit_rows:
        pc = ((r.get("product") or {}).get("product_code") or "").upper()
        if pc:
            fit_counts[pc] += 1

    try:
        svm = supabase_get_all("store_variant_map?select=itemid&store=eq.heavy_iron")
        variant_map = {str(r.get("itemid") or "").upper() for r in svm if r.get("itemid")}
    except Exception:
        variant_map = set()

    print("Indexing live Shopify …", file=sys.stderr)
    live_handles = live_shopify_index()

    # Track itemids: TNT/BS track types from TT + shop part_type Rubber Track
    track_itemids: set[str] = set()
    for iid, row in tt.items():
        if iid.startswith("TNT") or iid.startswith("BS"):
            track_itemids.add(iid)
    for iid, row in shop.items():
        if "rubber track" in (row.get("part_type") or "").lower():
            track_itemids.add(iid)

    by_size: dict[str, list[dict]] = defaultdict(list)
    all_track_results: list[dict] = []

    for iid in sorted(track_itemids):
        rec = validate_itemid(
            iid,
            tt=tt,
            db=db,
            shop=shop,
            manifest=manifest,
            live_handles=live_handles,
            fitment_counts=dict(fit_counts),
            variant_map=variant_map,
        )
        size_key = norm_size(rec["track_size"]) or "(unknown)"
        if args.track_size and size_key != norm_size(args.track_size):
            continue
        by_size[size_key].append(rec)
        all_track_results.append(rec)

    # UC validation (not by size)
    uc_results: list[dict] = []
    uc_ids = {r["product_code"].upper() for r in db_rows if r.get("type") == "uc_part"}
    uc_ids.update(iid for iid, r in shop.items() if "rubber track" not in (r.get("part_type") or "").lower() and not iid.startswith("TNT"))
    for iid in sorted(uc_ids):
        if iid.startswith("TNT"):
            continue
        uc_results.append(
            validate_itemid(
                iid,
                tt=tt,
                db=db,
                shop=shop,
                manifest=manifest,
                live_handles=live_handles,
                fitment_counts=dict(fit_counts),
                variant_map=variant_map,
            )
        )

    print("\n" + "#" * 60)
    print("CATALOG VALIDATION — TRACKS BY SIZE")
    print("#" * 60)
    print(f"TrackTech export: {tt_path.name} ({len(tt)} itemids)")
    print(f"Supabase products: {len(db)} | fitment (tracktech_export): {len(fit_rows)} rows")
    print(f"Canonical manifest: {len(manifest)} | Live Shopify handles: {len(live_handles)}")
    print(f"Track itemids under review: {len(all_track_results)}")

    fully_ok = sum(1 for x in all_track_results if x["ok"])
    print(f"\nOVERALL TRACKS: {fully_ok}/{len(all_track_results)} pass all {len(CHECKS)} checks")

    global_issues = Counter()
    for x in all_track_results:
        for iss in x["issues"]:
            global_issues[iss] += 1
    print("\nGlobal track issue counts:")
    for k, n in global_issues.most_common():
        print(f"  {k}: {n}")

    # Sort sizes by fail count desc
    size_order = sorted(
        by_size.keys(),
        key=lambda s: (sum(1 for x in by_size[s] if not x["ok"]), -len(by_size[s])),
        reverse=True,
    )
    for size in size_order:
        print_size_report(size, by_size[size], args.verbose)

    uc_ok = sum(1 for x in uc_results if x["ok"])
    print(f"\n{'='*60}")
    print(f"UNDERCARRIAGE / UC: {uc_ok}/{len(uc_results)} fully valid")
    uc_issues = Counter()
    for x in uc_results:
        for iss in x["issues"]:
            uc_issues[iss] += 1
    for k, n in uc_issues.most_common(5):
        print(f"  {k}: {n}")

    report = {
        "store": STORE,
        "tracktech_export": str(tt_path),
        "summary": {
            "tracks_total": len(all_track_results),
            "tracks_ok": fully_ok,
            "uc_total": len(uc_results),
            "uc_ok": uc_ok,
            "checks": list(CHECKS),
        },
        "track_issues": dict(global_issues),
        "uc_issues": dict(uc_issues),
        "by_track_size": {
            size: items for size, items in sorted(by_size.items())
        },
        "uc_items": uc_results,
    }

    if args.json:
        out = Path(args.json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nWrote {out}")

    return 0 if fully_ok == len(all_track_results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
