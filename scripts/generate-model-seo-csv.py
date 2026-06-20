#!/usr/bin/env python3
"""Generate Matrixify model metaobject SEO import CSV from Supabase export JSON."""
import csv
import json
import sys
from pathlib import Path

FALLBACKS = {
    "mustang-1650rt": (
        "Mustang 1650RT Rubber Tracks, Parts & Attachments | Heavy Iron Supply Co",
        "Shop OEM-spec rubber tracks, undercarriage parts, and attachments for the Mustang 1650RT. Free LTL freight, 24-month warranty, same-day shipping before 12PM CT.",
    ),
    "cat-249d": (
        "CAT 249D Rubber Tracks, Parts & Attachments | Heavy Iron Supply Co",
        "Shop CAT 249D compact track loader rubber tracks, undercarriage parts, and attachments. OEM-cross-referenced fitment, free freight to 48 states.",
    ),
    "cat-239d": (
        "CAT 239D Rubber Tracks, Parts & Attachments | Heavy Iron Supply Co",
        "Shop CAT 239D compact track loader rubber tracks, undercarriage parts, and attachments. OEM-cross-referenced fitment, free freight to 48 states.",
    ),
    "cat-259b3": (
        "CAT 259B3 Rubber Tracks, Parts & Attachments | Heavy Iron Supply Co",
        "Shop CAT 259B3 compact track loader rubber tracks, undercarriage parts, and attachments. OEM-cross-referenced fitment, free freight to 48 states.",
    ),
}


def main() -> None:
    raw = sys.stdin.read()
    rows = json.loads(raw)
    out = Path(__file__).resolve().parents[1] / "data" / "matrixify-model-seo-top50.csv"
    out.parent.mkdir(exist_ok=True)

    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Handle", "Command", "Field: seo_title", "Field: seo_description"])
        count = 0
        for row in rows:
            handle = row.get("handle")
            if not handle:
                continue
            title = row.get("seo_title") or FALLBACKS.get(handle, (None, None))[0]
            desc = row.get("seo_description") or FALLBACKS.get(handle, (None, None))[1]
            if not title or not desc:
                continue
            w.writerow([handle, "MERGE", title, desc])
            count += 1
    print(f"Wrote {count} rows to {out}")


if __name__ == "__main__":
    main()
