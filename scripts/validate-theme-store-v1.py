#!/usr/bin/env python3
"""Static + optional dev Shopify checks for Store V1 theme rendering.

Writes SHOPIFY_THEME_TEST_REPORT.md

Usage:
  python3 scripts/validate-theme-store-v1.py
  python3 scripts/validate-theme-store-v1.py --shopify-check
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "SHOPIFY_THEME_TEST_REPORT.md"
STORE = os.environ.get("SHOPIFY_STORE_DOMAIN", "tracktech-530.myshopify.com")
PILOTS = ("john-deere-323e", "kubota-svl75-2")

MO_QUERY = """
query ModelPilot($handle: String!) {
  metaobjectByHandle(handle: { type: "model", handle: $handle }) {
    handle
    heroImage: field(key: "hero_image") { value }
    primaryTrackSize: field(key: "primary_track_size") { value }
    trackProducts: field(key: "track_products") {
      references(first: 5) { nodes { ... on Product { handle title } } }
    }
    ucProducts: field(key: "uc_products") {
      references(first: 5) { nodes { ... on Product { handle title } } }
    }
  }
}
"""


def static_report() -> list[str]:
    lines = ["## Static theme analysis\n"]
    templates = {
        "Model metaobject page": ROOT / "templates/metaobject/model.json",
        "Machine fitment page": ROOT / "templates/page.machine-fitment.json",
    }
    for label, path in templates.items():
        if path.is_file():
            text = path.read_text(encoding="utf-8")
            section = "main-fitment" if "main-fitment" in text else "main-machine-fitment"
            lines.append(f"- **{label}** → `{section}`\n")
        else:
            lines.append(f"- **{label}** — MISSING `{path.name}`\n")

    snippets = [
        "snippets/hi-track-grouped-cards.liquid",
        "snippets/hi-uc-category-sections.liquid",
        "snippets/hi-product-card.liquid",
        "snippets/hi-machine-jsonld.liquid",
    ]
    lines.append("\n### Snippets\n\n")
    for s in snippets:
        ok = (ROOT / s).is_file()
        lines.append(f"- {'✓' if ok else '✗'} `{s}`\n")

    lines.append("\n### DoD field coverage (`main-fitment.liquid`)\n\n")
    mf = (ROOT / "sections/main-fitment.liquid").read_text(encoding="utf-8")
    checks = [
        ("Hero image", "hero_img"),
        ("Specs", "hi-mf__specs"),
        ("Rubber tracks (grouped)", "hi-track-grouped-cards"),
        ("Sprockets/idlers/rollers", "hi-uc-category-sections"),
        ("Attachments", "featured_attachments"),
        ("Primary track size", "primary_track_size"),
    ]
    for label, needle in checks:
        lines.append(f"- {'✓' if needle in mf else '✗'} {label}\n")
    return lines


def shopify_pilot_check() -> list[str]:
    lines = ["## Dev Shopify metaobject check\n\n"]
    env = {
        **dict(os.environ),
        "SHOPIFY_CLI_AGENT_INFO": "n:cursor|v:1|p:cursor",
        "SHOPIFY_CLI_AGENT_IDS": "s:validate-theme|r:script|i:1",
    }
    for handle in PILOTS:
        cmd = [
            "shopify", "store", "execute", "--store", STORE,
            "--query", MO_QUERY, "--variables", json.dumps({"handle": handle}), "--json",
        ]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=60)
            if r.returncode != 0:
                lines.append(f"- **{handle}**: API error — {r.stderr[:200]}\n")
                continue
            data = json.loads(r.stdout)
            mo = data.get("metaobjectByHandle") or {}
            if not mo:
                lines.append(f"- **{handle}**: metaobject not found on dev store\n")
                continue
            hero = bool((mo.get("heroImage") or {}).get("value"))
            pts = (mo.get("primaryTrackSize") or {}).get("value") or "—"
            tracks = len(((mo.get("trackProducts") or {}).get("references") or {}).get("nodes") or [])
            uc = len(((mo.get("ucProducts") or {}).get("references") or {}).get("nodes") or [])
            lines.append(
                f"- **{handle}**: hero={'yes' if hero else 'no'}, "
                f"primary_track_size={pts}, track_products≥{tracks}, uc_products≥{uc}\n"
            )
            lines.append(f"  Preview URL: `https://{STORE.replace('.myshopify.com', '')}.myshopify.com/pages/fitment/{handle}`\n")
        except Exception as e:
            lines.append(f"- **{handle}**: {e}\n")
    return lines


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shopify-check", action="store_true", help="Query dev store for pilot metaobjects")
    args = ap.parse_args()

    body = [
        "# Shopify Theme Test Report — Store V1\n",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n",
        f"Dev store: `{STORE}`\n",
        "**Production:** not tested (blocked by policy)\n\n",
    ]
    body.extend(static_report())

    if args.shopify_check:
        body.extend(shopify_pilot_check())
    else:
        body.append(
            "\n> Run with `--shopify-check` after Matrixify import to verify pilot metaobjects on dev.\n"
        )

    body.append("\n## Manual preview checklist\n\n")
    body.append("1. Push theme to unpublished preview on `tracktech-530`\n")
    body.append("2. Open `/pages/fitment/john-deere-323e` — hero, grouped tracks, UC categories\n")
    body.append("3. Confirm TNT variants appear before BS/TT within each track size group\n")
    body.append("4. Confirm wide track size group appears before narrow (400 before 320 on 323E)\n")
    body.append("5. Attachments section renders when `featured_attachments` populated\n")

    REPORT.write_text("".join(body), encoding="utf-8")
    print(f"Wrote {REPORT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
