#!/usr/bin/env python3
"""P0: Backfill missing fleet_machine_track_size_options (88 machines).

Inserts primary v2 track size into core.machine_approved_track_size for active_v1
machines that have primary_track_size_id but no approved options row.

Dev Supabase only.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

SQL_PRIMARY = """
INSERT INTO core.machine_approved_track_size (
  machine_id, track_size_id, canonical_size, track_finder_size,
  display_priority, approval_status, source
)
SELECT
  c.machine_id,
  c.track_size_id,
  vts.canonical_size,
  vts.canonical_size,
  1,
  'approved',
  'p0_primary_backfill'
FROM fleet_machine_catalog c
JOIN core.v_track_size_v2 vts ON vts.track_size_id = c.track_size_id
WHERE COALESCE(c.track_size_id, '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM core.machine_approved_track_size m
    WHERE m.machine_id = c.machine_id
  )
ON CONFLICT (machine_id, track_size_id) DO NOTHING;
"""

SQL_QA_V2 = """
INSERT INTO core.machine_approved_track_size (
  machine_id, track_size_id, canonical_size, track_finder_size,
  display_priority, approval_status, source
)
SELECT
  qp.machine_id,
  qp.product_track_size_id,
  vts.canonical_size,
  MIN(qp.product_track_size),
  1,
  'approved',
  'p0_qa_v2_backfill'
FROM fleet_qa_parts qp
JOIN core.v_track_size_v2 vts ON vts.track_size_id = qp.product_track_size_id
WHERE COALESCE(qp.product_track_size_id, '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM fleet_machine_track_size_options o
    WHERE o.machine_id = qp.machine_id
  )
GROUP BY qp.machine_id, qp.product_track_size_id, vts.canonical_size
ON CONFLICT (machine_id, track_size_id) DO NOTHING;
"""

SQL_SIBLING = """
INSERT INTO core.machine_approved_track_size (
  machine_id, track_size_id, canonical_size, track_finder_size,
  display_priority, approval_status, source
)
SELECT DISTINCT ON (c.machine_id, s.track_size_id)
  c.machine_id,
  s.track_size_id,
  s.canonical_size,
  s.track_finder_size,
  s.display_priority,
  'approved',
  'p0_sibling_backfill'
FROM fleet_machine_catalog c
JOIN fleet_machine_catalog sib
  ON sib.canonical_model_group = c.canonical_model_group
 AND sib.machine_id <> c.machine_id
 AND COALESCE(c.canonical_model_group, '') <> ''
JOIN core.machine_approved_track_size s ON s.machine_id = sib.machine_id
WHERE NOT EXISTS (
  SELECT 1 FROM fleet_machine_track_size_options o
  WHERE o.machine_id = c.machine_id
)
ON CONFLICT (machine_id, track_size_id) DO NOTHING;
"""

SQL_BRAND_TYPE_DONOR = """
INSERT INTO core.machine_approved_track_size (
  machine_id, track_size_id, canonical_size, track_finder_size,
  display_priority, approval_status, source
)
SELECT DISTINCT ON (c.machine_id, d.track_size_id)
  c.machine_id,
  d.track_size_id,
  d.canonical_size,
  d.track_finder_size,
  d.display_priority,
  'approved',
  'p0_brand_type_donor'
FROM fleet_machine_catalog c
JOIN fleet_machine_catalog donor
  ON donor.brand = c.brand
 AND donor.machine_type = c.machine_type
 AND donor.machine_id <> c.machine_id
JOIN core.machine_approved_track_size d ON d.machine_id = donor.machine_id
WHERE NOT EXISTS (
  SELECT 1 FROM fleet_machine_track_size_options o
  WHERE o.machine_id = c.machine_id
)
ON CONFLICT (machine_id, track_size_id) DO NOTHING;
"""

SQL_BRAND_DONOR = """
INSERT INTO core.machine_approved_track_size (
  machine_id, track_size_id, canonical_size, track_finder_size,
  display_priority, approval_status, source
)
SELECT DISTINCT ON (c.machine_id, d.track_size_id)
  c.machine_id,
  d.track_size_id,
  d.canonical_size,
  d.track_finder_size,
  d.display_priority,
  'approved',
  'p0_brand_donor'
FROM fleet_machine_catalog c
JOIN fleet_machine_catalog donor
  ON donor.brand = c.brand
 AND donor.machine_id <> c.machine_id
JOIN core.machine_approved_track_size d ON d.machine_id = donor.machine_id
WHERE NOT EXISTS (
  SELECT 1 FROM fleet_machine_track_size_options o
  WHERE o.machine_id = c.machine_id
)
ON CONFLICT (machine_id, track_size_id) DO NOTHING;
"""


def main() -> int:
    import psycopg
    from lib.dev_supabase import get_dev_postgres_url

    with psycopg.connect(get_dev_postgres_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) FROM fleet_machine_catalog c
                WHERE NOT EXISTS (
                  SELECT 1 FROM fleet_machine_track_size_options o
                  WHERE o.machine_id = c.machine_id
                )
                """
            )
            before = cur.fetchone()[0]
            inserted = 0
            for stmt in (SQL_PRIMARY, SQL_QA_V2, SQL_SIBLING, SQL_BRAND_TYPE_DONOR, SQL_BRAND_DONOR):
                cur.execute(stmt)
                inserted += cur.rowcount
            conn.commit()
            cur.execute(
                """
                SELECT COUNT(*) FROM fleet_machine_catalog c
                WHERE NOT EXISTS (
                  SELECT 1 FROM fleet_machine_track_size_options o
                  WHERE o.machine_id = c.machine_id
                )
                """
            )
            after = cur.fetchone()[0]

    print(f"Machines missing track size options: {before} → {after} (inserted {inserted})")
    return 0 if after == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
