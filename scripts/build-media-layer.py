#!/usr/bin/env python3
"""Build My Fleet media layer: production + local sources → dev core.media_asset."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))

OUT = REPO / "supabase/quality-audit"
SCHEMA = OUT / "media_asset_schema.sql"
MIGRATION = OUT / "media_migration_from_production.sql"
MAPPING = OUT / "media_mapping_report.csv"
REVIEW = OUT / "media_review_queue.csv"
VIEWS = OUT / "fleet_media_views.sql"
CHUNK_DIR = OUT / "media_migration_chunks"

DEV_REF = "zhdqdxtwipcowbtdyviq"
PARENT_REF = "tcykyktvdlsbscrsbjyt"


def get_dev_db_url() -> str:
    out = subprocess.check_output(
        [
            "npx",
            "supabase",
            "branches",
            "get",
            DEV_REF,
            "--project-ref",
            PARENT_REF,
            "-o",
            "json",
        ],
        cwd=REPO,
        text=True,
    )
    return json.loads(out)["POSTGRES_URL_NON_POOLING"]


def apply_schema(conn) -> None:
    schema_src = REPO / "supabase/quality-audit/phase2/media_asset_schema.sql"
    sql = schema_src.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()


def apply_migration(conn, sql_path: Path) -> None:
    sql = sql_path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()


def split_chunks(sql_path: Path) -> int:
    CHUNK_DIR.mkdir(parents=True, exist_ok=True)
    statements: list[str] = []
    buf: list[str] = []
    for line in sql_path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("--"):
            continue
        buf.append(line)
        if line.rstrip().endswith(";"):
            statements.append("\n".join(buf).strip())
            buf = []
    chunk_size = 60
    for i in range(0, len(statements), chunk_size):
        chunk = statements[i : i + chunk_size]
        (CHUNK_DIR / f"chunk_{i // chunk_size:02d}.sql").write_text("\n\n".join(chunk) + "\n")
    return (len(statements) + chunk_size - 1) // chunk_size


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply schema + migration to dev Postgres")
    parser.add_argument("--apply-chunks", action="store_true", help="Apply migration in chunks (safer)")
    args = parser.parse_args()

    from lib.media_layer import build_media_layer, write_mapping_report, write_migration_sql, write_review_queue

    print("Loading production media + dev core indexes…", flush=True)
    result = build_media_layer()

    phase_schema = REPO / "supabase/quality-audit/phase2/media_asset_schema.sql"
    SCHEMA.write_text(phase_schema.read_text(encoding="utf-8"))

    views_src = REPO / "supabase/quality-audit/phase2/media_fleet_views.sql"
    VIEWS.write_text(views_src.read_text(encoding="utf-8"))

    write_migration_sql(MIGRATION, result)
    write_mapping_report(MAPPING, result)
    write_review_queue(REVIEW, result)
    n_chunks = split_chunks(MIGRATION)

    print(f"Assets: {len(result.assets)}")
    print(f"Model links: {len(result.model_links)}")
    print(f"Track-size links: {len(result.track_links)}")
    print(f"Product links: {len(result.product_links)}")
    print(f"Review queue: {len(result.reviews)}")
    print(f"Wrote {SCHEMA}")
    print(f"Wrote {MIGRATION}")
    print(f"Wrote {MAPPING}")
    print(f"Wrote {REVIEW}")
    print(f"Wrote {VIEWS}")
    print(f"Split into {n_chunks} chunks under {CHUNK_DIR}")

    if not args.apply and not args.apply_chunks:
        return 0

    import psycopg

    db_url = get_dev_db_url()
    if DEV_REF not in db_url:
        print("Refusing: DB URL is not dev branch", file=sys.stderr)
        return 1

    with psycopg.connect(db_url) as conn:
        print("Applying media_asset_schema…", flush=True)
        apply_schema(conn)
        views_sql = VIEWS.read_text(encoding="utf-8")
        with conn.cursor() as cur:
            cur.execute(views_sql)
        conn.commit()
        print("Applied fleet_media_views", flush=True)

        if args.apply_chunks:
            for chunk_path in sorted(CHUNK_DIR.glob("chunk_*.sql")):
                print(f"Applying {chunk_path.name}…", flush=True)
                apply_migration(conn, chunk_path)
        else:
            print("Applying media_migration_from_production…", flush=True)
            apply_migration(conn, MIGRATION)

    print("Done — dev media layer loaded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
