#!/usr/bin/env python3
"""Store V1 — generate all Matrixify import files into MATRIXIFY_IMPORT_FILES/.

Never touches production Shopify or Supabase.

Outputs:
  MATRIXIFY_IMPORT_FILES/
    models/model_metaobjects_matrixify.xlsx
    models/model_track_variants_matrixify.xlsx
    models/model_media_matrixify.xlsx
    products/products_matrixify.xlsx (+ .csv)
    metafields/product_metafields_backfill.csv (if Products.csv available)
    MANIFEST.json
    README.md

Usage:
  python3 scripts/export-store-v1-bundle.py
  ./scripts/fitment export-store-v1
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "MATRIXIFY_IMPORT_FILES"
MODEL_SRC = ROOT / "data" / "model-publish"
PRODUCT_CSV = ROOT / "data" / "heavy-iron-matrixify-import.csv"
PRODUCT_XLSX = ROOT / "data" / "heavy-iron-matrixify-import.xlsx"
METAFIELD_CSV = ROOT / "data" / "heavy-iron-metafield-backfill.csv"
PRODUCTS_EXPORT = Path.home() / "Desktop/SUPABASE/Products.csv"


def run(cmd: list[str], label: str) -> tuple[bool, str]:
    print(f"\n=== {label} ===", flush=True)
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    out = (r.stdout or "") + (r.stderr or "")
    print(out, flush=True)
    return r.returncode == 0, out


def copy_if_exists(src: Path, dest: Path) -> bool:
    if not src.is_file():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return True


def main() -> int:
    manifest: dict = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "store_v1": True,
        "target_store": "tracktech-530.myshopify.com",
        "production_blocked": True,
        "files": [],
        "steps": [],
    }

    ok, _ = run([sys.executable, "scripts/export-model-matrixify.py"], "Model metaobject contract")
    manifest["steps"].append({"step": "export-model-matrixify", "ok": ok})
    if not ok:
        print("WARN: model export failed", file=sys.stderr)

    ok_prod, _ = run(
        [sys.executable, "scripts/generate-matrixify-import.py", "--full", "--xlsx"],
        "Product Matrixify import (full catalog)",
    )
    manifest["steps"].append({"step": "generate-matrixify-import", "ok": ok_prod})

    if PRODUCTS_EXPORT.is_file():
        ok_meta, _ = run(
            [
                sys.executable,
                "scripts/generate-matrixify-from-products-csv.py",
                "--shopify-csv",
                str(PRODUCTS_EXPORT),
            ],
            "Product metafield backfill from Products.csv",
        )
        manifest["steps"].append({"step": "generate-metafield-backfill", "ok": ok_meta})
    else:
        manifest["steps"].append(
            {"step": "generate-metafield-backfill", "ok": False, "reason": "Products.csv missing"}
        )

    # Layout
    models_dir = OUT / "models"
    products_dir = OUT / "products"
    metafields_dir = OUT / "metafields"
    media_dir = OUT / "media"
    for d in (models_dir, products_dir, metafields_dir, media_dir):
        d.mkdir(parents=True, exist_ok=True)

    mappings = [
        (MODEL_SRC / "model_metaobjects_matrixify.xlsx", models_dir / "model_metaobjects_matrixify.xlsx"),
        (MODEL_SRC / "model_track_variants_matrixify.xlsx", models_dir / "model_track_variants_matrixify.xlsx"),
        (MODEL_SRC / "model_media_matrixify.xlsx", media_dir / "model_media_matrixify.xlsx"),
        (MODEL_SRC / "model-publish-contract-report.csv", models_dir / "model-publish-contract-report.csv"),
        (MODEL_SRC / "matrixify-model-publish.csv", models_dir / "matrixify-model-publish.csv"),
        (MODEL_SRC / "shopify-api-manifest.json", models_dir / "shopify-api-manifest.json"),
        (PRODUCT_CSV, products_dir / "products_matrixify.csv"),
        (PRODUCT_XLSX, products_dir / "products_matrixify.xlsx"),
        (METAFIELD_CSV, metafields_dir / "product_metafields_backfill.csv"),
        (ROOT / "docs/MATRIXIFY_MODEL_PUBLISH_RUNBOOK.md", OUT / "README.md"),
    ]

    for src, dest in mappings:
        if copy_if_exists(src, dest):
            manifest["files"].append(
                {"path": str(dest.relative_to(ROOT)), "bytes": dest.stat().st_size}
            )

    (OUT / "MANIFEST.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"\nWrote {OUT}/ ({len(manifest['files'])} files)")
    print("Import order: products → metafields → models → verify preview theme")
    return 0 if manifest["files"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
