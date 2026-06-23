#!/usr/bin/env python3
"""Promote approved enrichment_candidates → core.model (explicit approval only).

Never runs on pending/conflict rows. Appends source_systems audit trail.

Usage:
  python3 scripts/apply-enrichment-approvals.py --dry-run
  python3 scripts/apply-enrichment-approvals.py --apply
  python3 scripts/apply-enrichment-approvals.py --apply --batch-id industry_research_20260623_*
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

ALLOWED_FIELDS = frozenset(
    {
        "machine_type",
        "canonical_model_group",
        "operating_weight_lbs",
        "horsepower",
        "std_gpm",
        "hf_gpm",
        "std_psi",
    }
)


def main() -> int:
    ap = argparse.ArgumentParser(description="Apply approved enrichment candidates to core.model")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--batch-id", help="Limit to batch_id")
    ap.add_argument("--reviewed-by", default="industry_research_admin")
    args = ap.parse_args()

    import psycopg
    from lib.dev_supabase import get_dev_postgres_url

    sql = """
    SELECT candidate_id, machine_id, field_name, proposed_value, source_type, batch_id
    FROM core.enrichment_candidates
    WHERE status = 'approved'
    """
    params: list[str] = []
    if args.batch_id:
        sql += " AND batch_id = %s"
        params.append(args.batch_id)

    with psycopg.connect(get_dev_postgres_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

            if not rows:
                print("No approved candidates to apply.")
                return 0

            print(f"Approved candidates: {len(rows)}")
            applied = 0
            skipped = 0

            for cid, mid, field_name, proposed, source_type, batch_id in rows:
                if field_name not in ALLOWED_FIELDS:
                    print(f"  SKIP {cid}: field {field_name} not allowed")
                    skipped += 1
                    continue

                cur.execute(
                    f"SELECT {field_name}, navigation_source FROM core.model WHERE machine_id = %s",
                    (mid,),
                )
                current_row = cur.fetchone()
                if not current_row:
                    print(f"  SKIP {mid}: machine not found")
                    skipped += 1
                    continue
                current_val, nav_src = current_row
                if current_val is not None and str(current_val) == str(proposed):
                    print(f"  OK   {mid}.{field_name} already {proposed!r}")
                    skipped += 1
                    continue

                stamp = f"enrichment:{source_type}:{batch_id or cid}"
                if args.apply:
                    cur.execute(
                        f"""
                        UPDATE core.model
                        SET {field_name} = %s,
                            source_systems = COALESCE(source_systems, '') || CASE
                              WHEN COALESCE(source_systems, '') = '' THEN %s
                              ELSE ',' || %s
                            END,
                            validation_status = COALESCE(validation_status, 'enriched')
                        WHERE machine_id = %s
                        """,
                        (proposed, stamp, stamp, mid),
                    )
                print(f"  {'APPLY' if args.apply else 'PLAN'} {mid}.{field_name}: {current_val!r} → {proposed!r} ({source_type})")
                applied += 1

            if args.apply:
                conn.commit()

    print(f"\nDone: {'applied' if args.apply else 'planned'}={applied}, skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
