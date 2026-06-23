#!/usr/bin/env python3
"""Pass/fail launch gates for curated Heavy Iron track sizes.

Reuses validation from validate-catalog-ssot.py and applies tier thresholds
per track size bucket (not full TrackTech catalog).

Usage:
  python3 scripts/launch-gate.py --tier dev
  python3 scripts/launch-gate.py --tier launch --size 450x86x58 --size 450x86x60
  python3 scripts/launch-gate.py --tier prod --json data/launch-gate-report.json --verbose
"""
from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from lib.catalog_ssot import load_dotenv_fitment, supabase_get_all, supabase_key  # noqa: E402

DEFAULT_SIZES = (
    "450x86x58",
    "450x86x60",
    "450x86x55",
    "320x86x52",
    "400x86x53",
)

TIERS: dict[str, dict] = {
    "dev": {
        "min_score": 5,
        "min_score_pct": 0.50,
        "min_live_shopify_pct": 0.40,
        "min_perfect_count": 1,
    },
    "launch": {
        "min_score": 6,
        "min_score_pct": 0.70,
        "min_live_shopify_pct": 0.60,
        "min_canonical_manifest_pct": 0.50,
    },
    "prod": {
        "min_score": 6,
        "min_score_pct": 0.85,
        "min_live_shopify_pct": 0.80,
        "min_perfect_pct": 0.80,
    },
}


def _load_validate_module():
    path = ROOT / "scripts" / "validate-catalog-ssot.py"
    spec = importlib.util.spec_from_file_location("validate_catalog_ssot", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_shop_image_coverage(path: Path) -> dict[str, bool]:
    """itemid -> True if any Products.csv row has Image Src."""
    out: dict[str, bool] = {}
    if not path.is_file():
        return out
    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            iid = ""
            for k, v in row.items():
                if "tracktech_itemid" in k.lower() and (v or "").strip():
                    iid = v.strip().upper()
                    break
            if not iid:
                iid = (row.get("Variant SKU") or "").strip().upper()
            if not iid:
                continue
            has_img = bool((row.get("Image Src") or "").strip())
            prev = out.get(iid, False)
            out[iid] = prev or has_img
    return out


def pct(n: int, total: int) -> float:
    return (n / total) if total else 0.0


def fmt_pct(value: float) -> str:
    return f"{value * 100:.0f}%"


def evaluate_size(
    size: str,
    items: list[dict],
    *,
    tier: str,
    image_map: dict[str, bool],
    thresholds: dict,
) -> dict:
    n = len(items)
    with_image = sum(1 for it in items if image_map.get(it["itemid"], False))
    image_pct = pct(with_image, n)

    if n == 0:
        return {
            "size": size,
            "pass": False,
            "total": 0,
            "image_src_pct": image_pct,
            "checks": {"items_present": False},
            "metrics": {},
            "failures": ["no track itemids in bucket"],
            "failing_itemids": [],
        }

    min_score = thresholds["min_score"]
    score_ok = sum(1 for it in items if it["score"] >= min_score)
    live_ok = sum(1 for it in items if it["checks"]["live_shopify"])
    manifest_ok = sum(1 for it in items if it["checks"]["canonical_manifest"])
    perfect_ok = sum(1 for it in items if it["score"] == it["max_score"])

    score_pct = pct(score_ok, n)
    live_pct = pct(live_ok, n)
    manifest_pct = pct(manifest_ok, n)
    perfect_pct = pct(perfect_ok, n)

    metrics = {
        f"score>={min_score}/{items[0]['max_score']}": {
            "count": score_ok,
            "pct": score_pct,
            "required_pct": thresholds["min_score_pct"],
        },
        "live_shopify": {
            "count": live_ok,
            "pct": live_pct,
            "required_pct": thresholds["min_live_shopify_pct"],
        },
        "image_src": {
            "count": with_image,
            "pct": image_pct,
            "required_pct": None,
        },
    }

    checks: dict[str, bool] = {
        "items_present": True,
        "score_threshold": score_pct >= thresholds["min_score_pct"],
        "live_shopify": live_pct >= thresholds["min_live_shopify_pct"],
    }

    if tier == "dev":
        checks["min_perfect_count"] = perfect_ok >= thresholds["min_perfect_count"]
        metrics["perfect_7/7"] = {
            "count": perfect_ok,
            "pct": perfect_pct,
            "required_count": thresholds["min_perfect_count"],
        }
    elif tier == "launch":
        checks["canonical_manifest"] = manifest_pct >= thresholds["min_canonical_manifest_pct"]
        metrics["canonical_manifest"] = {
            "count": manifest_ok,
            "pct": manifest_pct,
            "required_pct": thresholds["min_canonical_manifest_pct"],
        }
    elif tier == "prod":
        checks["perfect_7/7"] = perfect_pct >= thresholds["min_perfect_pct"]
        metrics["perfect_7/7"] = {
            "count": perfect_ok,
            "pct": perfect_pct,
            "required_pct": thresholds["min_perfect_pct"],
        }

    failures: list[str] = []
    if not checks["score_threshold"]:
        failures.append(
            f"score>={min_score}/7: {fmt_pct(score_pct)} (need ≥{fmt_pct(thresholds['min_score_pct'])})"
        )
    if not checks["live_shopify"]:
        failures.append(
            f"live_shopify: {fmt_pct(live_pct)} (need ≥{fmt_pct(thresholds['min_live_shopify_pct'])})"
        )
    if tier == "dev" and not checks.get("min_perfect_count"):
        failures.append(f"perfect 7/7: {perfect_ok} (need ≥{thresholds['min_perfect_count']})")
    if tier == "launch" and not checks.get("canonical_manifest"):
        failures.append(
            "canonical_manifest: "
            f"{fmt_pct(manifest_pct)} (need ≥{fmt_pct(thresholds['min_canonical_manifest_pct'])})"
        )
    if tier == "prod" and not checks.get("perfect_7/7"):
        failures.append(
            f"perfect 7/7: {fmt_pct(perfect_pct)} (need ≥{fmt_pct(thresholds['min_perfect_pct'])})"
        )

    failing_itemids = [
        {
            "itemid": it["itemid"],
            "score": it["score"],
            "issues": it["issues"],
        }
        for it in sorted(items, key=lambda x: (x["score"], x["itemid"]))
        if it["score"] < min_score or not it["checks"]["live_shopify"]
    ]

    return {
        "size": size,
        "pass": all(checks.values()),
        "total": n,
        "image_src_pct": image_pct,
        "checks": checks,
        "metrics": metrics,
        "failures": failures,
        "failing_itemids": failing_itemids,
    }


def print_size_result(result: dict, *, verbose: bool) -> None:
    status = "PASS" if result["pass"] else "FAIL"
    print(f"\n{'=' * 60}")
    print(f"SIZE: {result['size']}  —  {status}  ({result['total']} itemids)")
    print(f"{'=' * 60}")

    if result["total"] == 0:
        for msg in result["failures"]:
            print(f"  ✗ {msg}")
        return

    for key, m in result["metrics"].items():
        req = m.get("required_pct")
        req_count = m.get("required_count")
        if req is not None:
            ok = m["pct"] >= req
            mark = "✓" if ok else "✗"
            print(
                f"  {mark} {key}: {m['count']}/{result['total']} "
                f"({fmt_pct(m['pct'])})  need ≥{fmt_pct(req)}"
            )
        elif req_count is not None:
            ok = m["count"] >= req_count
            mark = "✓" if ok else "✗"
            print(
                f"  {mark} {key}: {m['count']}  need ≥{req_count}"
            )
        else:
            print(
                f"  · {key}: {m['count']}/{result['total']} "
                f"({fmt_pct(m['pct'])})  [report only]"
            )

    if result["failures"]:
        print("  Gate failures:")
        for msg in result["failures"]:
            print(f"    - {msg}")

    if verbose and result["failing_itemids"]:
        print("  Failing itemids:")
        for it in result["failing_itemids"]:
            print(
                f"    [{it['score']}/7] {it['itemid']}  "
                f"issues={','.join(it['issues'])}"
            )


def curated_itemids_for_size(shop: dict[str, dict], size: str, norm_size_fn) -> set[str]:
    """Itemids in Products.csv for one track size (rubber track part type)."""
    want = norm_size_fn(size) or size.strip().lower()
    out: set[str] = set()
    for iid, row in shop.items():
        if "rubber track" not in (row.get("part_type") or "").lower():
            continue
        if (row.get("track_size_norm") or norm_size_fn(row.get("track_size") or "")) == want:
            out.add(iid)
    return out


def build_track_results(vcs, args) -> tuple[dict[str, list[dict]], dict, str | None]:
    """Return (by_size, image_map, shopify_error)."""
    tt_path = Path(args.tracktech)
    shop_path = Path(args.shopify_csv)

    print("Loading sources …", file=sys.stderr)
    tt = vcs.load_tracktech(tt_path)
    shop = vcs.load_shop_csv(shop_path)
    image_map = load_shop_image_coverage(shop_path)
    manifest = vcs.load_manifest()

    db_rows = supabase_get_all(
        "product?select=product_code,handle,type,track_size,tread_pattern,shopify_product_id&source=eq.itemid_ssot"
    )
    db = {r["product_code"].upper(): r for r in db_rows if r.get("product_code")}

    fit_rows = supabase_get_all(
        "fitment?select=product:product_id(product_code)&source=eq.tracktech_export"
    )
    fit_counts: dict[str, int] = {}
    for r in fit_rows:
        pc = ((r.get("product") or {}).get("product_code") or "").upper()
        if pc:
            fit_counts[pc] = fit_counts.get(pc, 0) + 1

    try:
        svm = supabase_get_all("store_variant_map?select=itemid&store=eq.heavy_iron")
        variant_map = {str(r.get("itemid") or "").upper() for r in svm if r.get("itemid")}
    except Exception:
        variant_map = set()

    shopify_error: str | None = None
    print("Indexing live Shopify …", file=sys.stderr)
    try:
        live_handles = vcs.live_shopify_index()
    except Exception as exc:
        shopify_error = str(exc).strip() or "live Shopify index failed (check shopify CLI / token)"
        print(f"WARN: {shopify_error}", file=sys.stderr)
        live_handles = {}

    track_itemids: set[str] = set()
    for iid, row in tt.items():
        if iid.startswith("TNT") or iid.startswith("BS"):
            track_itemids.add(iid)
    for iid, row in shop.items():
        if "rubber track" in (row.get("part_type") or "").lower():
            track_itemids.add(iid)

    by_size: dict[str, list[dict]] = {}
    for iid in sorted(track_itemids):
        rec = vcs.validate_itemid(
            iid,
            tt=tt,
            db=db,
            shop=shop,
            manifest=manifest,
            live_handles=live_handles,
            fitment_counts=fit_counts,
            variant_map=variant_map,
        )
        size_key = vcs.norm_size(rec["track_size"]) or "(unknown)"
        by_size.setdefault(size_key, []).append(rec)

    return by_size, image_map, shopify_error


def main() -> int:
    load_dotenv_fitment()
    vcs = _load_validate_module()

    ap = argparse.ArgumentParser(description="Launch pass/fail gates for curated track sizes")
    ap.add_argument("--tier", choices=sorted(TIERS), default="dev")
    ap.add_argument(
        "--size",
        action="append",
        dest="sizes",
        help="Track size bucket (repeatable; default: core launch sizes)",
    )
    ap.add_argument("--tracktech", default=str(vcs.DEFAULT_TT))
    ap.add_argument("--shopify-csv", default=str(vcs.DEFAULT_SHOP_CSV))
    ap.add_argument(
        "--scope",
        choices=("curated", "all"),
        default="curated",
        help="curated = Products.csv rubber tracks in bucket only; all = full TrackTech bucket",
    )
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--json", help="Write report JSON path")
    args = ap.parse_args()

    if not supabase_key():
        print("Run ./scripts/fitment bootstrap", file=sys.stderr)
        return 1

    requested = [vcs.norm_size(s) or s.strip().lower() for s in (args.sizes or DEFAULT_SIZES)]
    thresholds = TIERS[args.tier]

    by_size, image_map, shopify_error = build_track_results(vcs, args)

    print("\n" + "#" * 60)
    print(f"HEAVY IRON LAUNCH GATE — tier={args.tier}")
    print("#" * 60)
    print(f"TrackTech: {Path(args.tracktech).name}")
    print(f"Products.csv: {Path(args.shopify_csv)}")
    print(f"Scope: {args.scope} (curated = Products.csv tracks in bucket)")
    print(f"Sizes under review: {', '.join(requested)}")
    if shopify_error:
        print(f"Shopify: ERROR — {shopify_error}")
        print("  (live_shopify checks will likely fail until Shopify CLI/token works)")

    shop = vcs.load_shop_csv(Path(args.shopify_csv))

    size_results: list[dict] = []
    for size in requested:
        items = by_size.get(size, [])
        if args.scope == "curated":
            curated = curated_itemids_for_size(shop, size, vcs.norm_size)
            items = [it for it in items if it["itemid"] in curated]
        result = evaluate_size(
            size,
            items,
            tier=args.tier,
            image_map=image_map,
            thresholds=thresholds,
        )
        size_results.append(result)
        print_size_result(result, verbose=args.verbose)

    passed = sum(1 for r in size_results if r["pass"])
    overall_pass = passed == len(size_results) and len(size_results) > 0
    overall_status = "PASS" if overall_pass else "FAIL"

    print(f"\n{'=' * 60}")
    print(f"OVERALL: {overall_status}  ({passed}/{len(size_results)} sizes passed)")
    print(f"{'=' * 60}")

    report = {
        "tier": args.tier,
        "thresholds": thresholds,
        "requested_sizes": requested,
        "tracktech_export": args.tracktech,
        "shopify_csv": args.shopify_csv,
        "shopify_error": shopify_error,
        "scope": args.scope,
        "overall_pass": overall_pass,
        "sizes_passed": passed,
        "sizes_total": len(size_results),
        "by_size": size_results,
    }

    if args.json:
        out = Path(args.json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nWrote {out}")

    return 0 if overall_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
