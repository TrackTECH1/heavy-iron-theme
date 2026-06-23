#!/usr/bin/env python3
"""Validate My Fleet track_size_v2 UI data against dev Supabase public fleet views."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "supabase" / "quality-audit" / "TRACK_SIZE_V2_UI_VALIDATION.md"
DEV_PROJECT = "zhdqdxtwipcowbtdyviq"


def load_env() -> tuple[str, str]:
    candidates = [
        REPO / "my-fleet" / ".env.local",
        REPO / "my-fleet" / ".env.fitment.local",
        REPO / ".env.fitment.local",
    ]
    url = key = None
    for env_path in candidates:
        if not env_path.exists():
            continue
        for line in env_path.read_text().splitlines():
            if line.startswith("NEXT_PUBLIC_SUPABASE_URL="):
                url = line.split("=", 1)[1].strip().strip('"')
            if line.startswith("NEXT_PUBLIC_SUPABASE_ANON_KEY="):
                key = line.split("=", 1)[1].strip().strip('"')
        if url and key:
            break
    url = url or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = key or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        sys.exit("Missing Supabase URL/key in my-fleet/.env.local")
    return url, key


def rest_get(url: str, key: str, path: str, params: str = "") -> list[dict]:
    req_url = f"{url.rstrip('/')}/rest/v1/{path}?{params}"
    req = urllib.request.Request(
        req_url,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def main() -> None:
    url, key = load_env()
    spine = rest_get(url, key, "fleet_track_size_spine", "select=canonical_size&limit=500")
    spine_rubber = [r for r in spine if "rubbertrack" in r["canonical_size"].lower()]
    spine_4plus = [
        r
        for r in spine
        if len([c for c in r["canonical_size"].lower().split("x") if c]) > 3
    ]

    jd_opts = rest_get(
        url,
        key,
        "fleet_machine_track_size_options",
        "machine_id=eq.mdl_john_deere_323e&select=canonical_size,option_label,display_priority&order=display_priority",
    )
    svl_parts = rest_get(
        url,
        key,
        "fleet_qa_parts",
        "machine_id=eq.mdl_kubota_svl75_2&product_type=ilike.*Track*&select=sku,product_track_size,title&order=sku",
    )
    svl_tnt = [p for p in svl_parts if p["sku"].upper().startswith("TNT")]
    svl_non_tnt = [p for p in svl_parts if not p["sku"].upper().startswith("TNT")]
    svl_bad = [
        p
        for p in svl_parts
        if "rubbertrack" in (p.get("product_track_size") or "").lower()
        or len((p.get("product_track_size") or "").lower().split("x")) > 3
    ]

    kubota = rest_get(
        url,
        key,
        "fleet_brands_catalog",
        "brand=eq.Kubota&select=brand,active_model_count,total_model_count",
    )[0]

    checks = [
        ("No RUBBERTRACK in spine", len(spine_rubber) == 0, f"found {len(spine_rubber)}"),
        ("No 4+ chunk sizes in spine", len(spine_4plus) == 0, f"found {len(spine_4plus)}"),
        ("Track-size page: 128 active sizes", len(spine) == 128, f"count={len(spine)}"),
        (
            "John Deere 323E Wide/Narrow",
            {o["option_label"]: o["canonical_size"] for o in jd_opts}
            == {"wide": "400x86x52", "narrow": "320x86x52"},
            str({o["option_label"]: o["canonical_size"] for o in jd_opts}),
        ),
        (
            "Kubota SVL75-2 TNT track products",
            len(svl_tnt) >= 10 and len(svl_bad) == 0,
            f"tnt={len(svl_tnt)} non_tnt={len(svl_non_tnt)} bad={len(svl_bad)}",
        ),
        (
            "Brand pages hide polluted Kubota machines",
            kubota["active_model_count"] < kubota["total_model_count"],
            f"active={kubota['active_model_count']} total={kubota['total_model_count']}",
        ),
    ]
    all_pass = all(c[1] for c in checks)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    lines = [
        "# Track Size V2 — My Fleet UI Validation",
        "",
        f"**Generated:** {now}  ",
        f"**Dev project:** `{DEV_PROJECT}`  ",
        f"**Spine view:** `core.v_track_size_spine_v2` → `public.fleet_track_size_spine`",
        "",
        "## Summary",
        "",
        f"**Overall:** {'PASS' if all_pass else 'FAIL'}",
        "",
        "## Checks",
        "",
        "| # | Criterion | Result | Evidence |",
        "|---|-----------|--------|----------|",
    ]
    for i, (name, ok, evidence) in enumerate(checks, 1):
        lines.append(f"| {i} | {name} | {'PASS' if ok else 'FAIL'} | {evidence} |")

    lines.extend(
        [
            "",
            "## John Deere 323E — approved track sizes",
            "",
            "| Label | Canonical size | Priority |",
            "|-------|----------------|----------|",
        ]
    )
    for o in jd_opts:
        lines.append(
            f"| {o['option_label']} | `{o['canonical_size']}` | {o['display_priority']} |"
        )

    lines.extend(
        [
            "",
            "## Kubota SVL75-2 — TNT track SKUs (sample)",
            "",
            "| SKU | V2 size |",
            "|-----|---------|",
        ]
    )
    for p in svl_tnt[:12]:
        lines.append(f"| `{p['sku']}` | `{p['product_track_size']}` |")
    if len(svl_tnt) > 12:
        lines.append(f"| … | *{len(svl_tnt) - 12} more TNT SKUs* |")

    lines.extend(
        [
            "",
            "## Kubota brand catalog filtering",
            "",
            f"- **Active (track-finder v1):** {kubota['active_model_count']} models",
            f"- **Total in godlist:** {kubota['total_model_count']} models",
            f"- **Hidden reference/noise:** {kubota['total_model_count'] - kubota['active_model_count']} models",
            "",
            "## App changes (My Fleet)",
            "",
            "- `public.fleet_track_size_spine` reads `core.v_track_size_spine_v2` only",
            "- `public.fleet_qa_parts` / `fleet_products` join `core.v_track_size_v2`",
            "- Track size options from `fleet_machine_track_size_options` only (no supplier QA fallback)",
            "- Client filter: `filterV2QaParts()` in `my-fleet/src/lib/track-size-v2.ts`",
            "",
            "## SQL artifact",
            "",
            "`supabase/quality-audit/phase2/track_size_v2_fleet_views.sql`",
            "",
        ]
    )

    OUT.write_text("\n".join(lines) + "\n")
    print(f"Wrote {OUT}")
    print("Overall:", "PASS" if all_pass else "FAIL")
    if not all_pass:
        sys.exit(1)


if __name__ == "__main__":
    main()
