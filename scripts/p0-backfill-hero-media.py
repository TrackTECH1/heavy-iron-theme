#!/usr/bin/env python3
"""P0: Backfill fleet_model_hero from manifest hero_url for pilot + manifest rows.

Dev Supabase only — links existing public URLs into core.model_media.
"""
from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

PILOTS = (
    "john-deere-323e",
    "kubota-svl75-2",
    "caterpillar-299d3",
    "ditch-witch-sk-1550",
)

MANIFEST = ROOT / "data/model-publish/shopify-api-manifest.json"


def main() -> int:
    import psycopg
    from lib.dev_supabase import get_dev_postgres_url

    manifest = json.loads(MANIFEST.read_text())
    targets = []
    pilot_set = set(PILOTS)
    for row in manifest.get("models") or []:
        handle = row.get("handle") or ""
        url = (row.get("hero_url") or "").strip()
        if not url or row.get("status") == "blocked":
            continue
        if handle in pilot_set or url:
            targets.append((row["machine_id"], handle, url))

    # Pilots first, then all manifest heroes
    seen = set()
    ordered = []
    for mid, h, u in targets:
        if h in pilot_set and (mid, h) not in seen:
            ordered.append((mid, h, u))
            seen.add((mid, h))
    for mid, h, u in targets:
        if (mid, h) not in seen:
            ordered.append((mid, h, u))
            seen.add((mid, h))

    with psycopg.connect(get_dev_postgres_url()) as conn:
        with conn.cursor() as cur:
            n = 0
            for machine_id, handle, url in ordered:
                media_id = f"med_hero_{handle.replace('-', '_')[:40]}"
                alt = f"{handle} hero"
                cur.execute(
                    """
                    INSERT INTO core.media_asset (media_id, url, alt_text, storage_bucket, storage_path, role, source_system)
                    VALUES (%s, %s, %s, 'machine-images', %s, 'hero', 'p0_hero_backfill')
                    ON CONFLICT (media_id) DO UPDATE SET url = EXCLUDED.url, alt_text = EXCLUDED.alt_text
                    """,
                    (media_id, url, alt, f"{handle}-hero.webp"),
                )
                cur.execute(
                    """
                    INSERT INTO core.model_media (machine_id, media_id, role, display_priority)
                    VALUES (%s, %s, 'hero', 1)
                    ON CONFLICT DO NOTHING
                    """,
                    (machine_id, media_id),
                )
                # Remove conflicting hero rows
                cur.execute(
                    """
                    DELETE FROM core.model_media mm
                    USING core.media_asset a
                    WHERE mm.machine_id = %s AND mm.role = 'hero' AND mm.media_id = a.media_id
                      AND a.media_id <> %s
                    """,
                    (machine_id, media_id),
                )
                n += 1

            cur.execute(
                """
                WITH candidates AS (
                  SELECT
                    c.machine_id,
                    c.shopify_handle,
                    'med_hero_ts_' || REPLACE(c.shopify_handle, '-', '_') AS media_id,
                    t.url,
                    COALESCE(t.alt_text, c.shopify_handle || ' track hero') AS alt_text,
                    COALESCE(t.storage_bucket, 'catalog-images') AS storage_bucket,
                    COALESCE(t.storage_path, '') AS storage_path
                  FROM fleet_machine_catalog c
                  JOIN LATERAL (
                    SELECT tsm.url, tsm.alt_text, tsm.storage_bucket, tsm.storage_path
                    FROM fleet_machine_track_size_options o
                    JOIN fleet_track_size_media tsm ON tsm.track_size_id = o.track_size_id
                    WHERE o.machine_id = c.machine_id
                      AND tsm.url IS NOT NULL AND tsm.url <> ''
                    ORDER BY o.is_default_recommended DESC, o.display_priority, tsm.display_priority NULLS LAST
                    LIMIT 1
                  ) t ON TRUE
                  WHERE NOT EXISTS (
                    SELECT 1 FROM fleet_model_hero h
                    WHERE h.machine_id = c.machine_id AND h.url IS NOT NULL AND h.url <> ''
                  )
                )
                INSERT INTO core.media_asset (media_id, url, alt_text, storage_bucket, storage_path, role, source_system)
                SELECT media_id, url, alt_text, storage_bucket, storage_path, 'hero', 'p0_track_size_fallback'
                FROM candidates
                ON CONFLICT (media_id) DO UPDATE SET url = EXCLUDED.url, alt_text = EXCLUDED.alt_text
                """
            )
            ts_assets = cur.rowcount

            cur.execute(
                """
                INSERT INTO core.model_media (machine_id, media_id, role, display_priority)
                SELECT c.machine_id, a.media_id, 'hero', 1
                FROM fleet_machine_catalog c
                JOIN core.media_asset a
                  ON a.media_id = 'med_hero_ts_' || REPLACE(c.shopify_handle, '-', '_')
                 AND a.source_system = 'p0_track_size_fallback'
                WHERE NOT EXISTS (
                  SELECT 1 FROM core.model_media mm
                  JOIN core.media_asset ha ON ha.media_id = mm.media_id
                  WHERE mm.machine_id = c.machine_id AND mm.role = 'hero'
                    AND ha.url IS NOT NULL AND ha.url <> ''
                )
                ON CONFLICT DO NOTHING
                """
            )
            conn.commit()
            print(f"Track-size hero fallback assets: {ts_assets}")

            cur.execute(
                """
                SELECT COUNT(*) FROM fleet_machine_catalog c
                JOIN fleet_model_hero h ON h.machine_id = c.machine_id
                WHERE h.url IS NOT NULL AND h.url <> ''
                """
            )
            heroes = cur.fetchone()[0]

    print(f"Upserted hero media for {n} machines; fleet_model_hero now covers {heroes} catalog machines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
