#!/usr/bin/env python3
"""Export Model metaobject publish contract → Matrixify XLSX workbooks.

Reads dev Supabase fleet_* views (active_v1 only). Never touches production.

Outputs (data/model-publish/):
  model_metaobjects_matrixify.xlsx
  model_track_variants_matrixify.xlsx
  model_media_matrixify.xlsx
  model-publish-contract-report.csv

Usage:
  python3 scripts/export-model-matrixify.py
  ./scripts/fitment export-matrixify
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

OUT_DIR = ROOT / "data" / "model-publish"
REPORT_CSV = OUT_DIR / "model-publish-contract-report.csv"


def write_report(path: Path, models) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "shopify_handle",
                "machine_id",
                "brand",
                "model",
                "publish_status",
                "hero",
                "primary_track_size",
                "track_products",
                "uc_products",
                "approved_track_sizes",
                "blockers",
            ]
        )
        for m in models:
            w.writerow(
                [
                    m.shopify_handle,
                    m.machine_id,
                    m.brand,
                    m.model,
                    m.publish_status,
                    "yes" if m.hero_url else "no",
                    m.primary_track_size,
                    len(m.track_product_handles),
                    len(m.uc_product_handles),
                    len(m.approved_track_sizes),
                    ";".join(m.blockers),
                ]
            )


def main() -> int:
    ap = argparse.ArgumentParser(description="Export Matrixify Model publish contract (XLSX)")
    ap.add_argument("--limit", type=int, default=0, help="Limit catalog models (debug)")
    args = ap.parse_args()

    import psycopg
    from lib.dev_supabase import get_dev_postgres_url
    from lib.model_publish_contract import export_matrixify_workbooks, fetch_contract

    print("Loading publish contract from dev Supabase …", flush=True)
    with psycopg.connect(get_dev_postgres_url()) as conn:
        models, variants, media = fetch_contract(conn)

    if args.limit:
        keep = {m.machine_id for m in models[: args.limit]}
        models = [m for m in models if m.machine_id in keep]
        variants = [v for v in variants if v.machine_id in keep]
        media = [r for r in media if r.machine_id in keep]

    counts = export_matrixify_workbooks(OUT_DIR, models, variants, media)
    write_report(REPORT_CSV, models)

    ready = sum(1 for m in models if m.publish_status == "ready")
    partial = sum(1 for m in models if m.publish_status == "partial")
    blocked = sum(1 for m in models if m.publish_status == "blocked")

    print(f"Catalog models: {len(models)} (ready={ready} partial={partial} blocked={blocked})")
    print(f"Matrixify metaobject rows: {counts['models']}")
    print(f"Track variant audit rows: {counts['variants']}")
    print(f"Media audit rows: {counts['media']}")
    print(f"Wrote {OUT_DIR / 'model_metaobjects_matrixify.xlsx'}")
    print(f"Wrote {OUT_DIR / 'model_track_variants_matrixify.xlsx'}")
    print(f"Wrote {OUT_DIR / 'model_media_matrixify.xlsx'}")
    print(f"Wrote {REPORT_CSV}")
    print("\nSee docs/MATRIXIFY_MODEL_PUBLISH_RUNBOOK.md for import + preview steps.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
