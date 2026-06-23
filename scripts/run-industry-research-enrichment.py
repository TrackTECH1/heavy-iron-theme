#!/usr/bin/env python3
"""Industry Research Enrichment — trusted sources only, approval before promotion.

Collects machine type, family, and spec candidates from curated sources.
Never overwrites core.model automatically.

Source priority:
  1. OEM websites / spec sheets (oem_source_registry.csv)
  2. Dealer spec pages (dealer_spec_registry.csv)
  3. Manufacturer brochures / PDFs (brochure_spec_registry.csv)
  4. Track Finder + Intelligent Fitment package CSV
  5. Manual review queue

Outputs (data/industry-research/):
  industry_research_queue.csv
  machine_type_enrichment_candidates.csv
  spec_enrichment_candidates.csv
  source_citations.csv
  approval_import.sql

Usage:
  python3 scripts/run-industry-research-enrichment.py
  python3 scripts/run-industry-research-enrichment.py --limit 50
  ./scripts/fitment industry-research
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from lib.industry_research import (  # noqa: E402
    RESEARCH_DIR,
    SPEC_FIELDS,
    CatalogMachine,
    build_queue,
    findings_to_candidates,
    generate_approval_sql,
    load_package_spec_findings,
    load_registry,
    load_track_finder_findings,
    new_batch_id,
    write_csv,
)

OUT = RESEARCH_DIR
OEM_REGISTRY = RESEARCH_DIR / "oem_source_registry.csv"
DEALER_REGISTRY = RESEARCH_DIR / "dealer_spec_registry.csv"
BROCHURE_REGISTRY = RESEARCH_DIR / "brochure_spec_registry.csv"


def fetch_catalog(limit: int | None) -> list[CatalogMachine]:
    import psycopg
    from lib.dev_supabase import get_dev_postgres_url

    sql = """
    SELECT
      machine_id, brand, model, shopify_handle,
      machine_type, canonical_model_group,
      operating_weight_lbs::text, horsepower::text,
      std_gpm::text, hf_gpm::text, std_psi::text,
      navigation_source, machine_status
    FROM fleet_machine_catalog
    WHERE machine_status = 'active_v1'
    ORDER BY brand, model
    """
    if limit:
        sql += f" LIMIT {int(limit)}"

    machines: list[CatalogMachine] = []
    with psycopg.connect(get_dev_postgres_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            for row in cur.fetchall():
                machines.append(CatalogMachine(*row))
    return machines


def main() -> int:
    ap = argparse.ArgumentParser(description="Industry research enrichment workflow")
    ap.add_argument("--limit", type=int, help="Limit catalog machines (dev smoke test)")
    ap.add_argument("--batch-id", help="Override batch id for approval_import.sql")
    ap.add_argument("--no-sql", action="store_true", help="Skip approval_import.sql")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    batch_id = args.batch_id or new_batch_id()

    print("Loading active_v1 catalog …")
    catalog = fetch_catalog(args.limit)
    by_id = {m.machine_id: m for m in catalog}
    print(f"  machines: {len(catalog)}")

    print("Building research queue …")
    queue = build_queue(catalog)
    write_csv(
        OUT / "industry_research_queue.csv",
        [
            {
                "machine_id": q.machine_id,
                "shopify_handle": q.shopify_handle,
                "brand": q.brand,
                "model": q.model,
                "priority": q.priority,
                "research_fields": "|".join(q.research_fields),
                "notes": q.notes,
            }
            for q in queue
        ],
        ["machine_id", "shopify_handle", "brand", "model", "priority", "research_fields", "notes"],
    )
    print(f"  queue rows: {len(queue)}")

    print("Collecting trusted-source findings …")
    findings = []
    for label, path in (
        ("oem", OEM_REGISTRY),
        ("dealer", DEALER_REGISTRY),
        ("brochure", BROCHURE_REGISTRY),
    ):
        rows = load_registry(path)
        print(f"  {label}: {len(rows)} from {path.name}")
        findings.extend(rows)
    tf = load_track_finder_findings()
    print(f"  track_finder: {len(tf)}")
    findings.extend(tf)
    pkg = load_package_spec_findings(by_id)
    print(f"  intelligent_fitment: {len(pkg)}")
    findings.extend(pkg)

    candidates, citations = findings_to_candidates(by_id, findings)
    type_rows = [c for c in candidates if c.field_name in ("machine_type", "canonical_model_group")]
    spec_rows = [c for c in candidates if c.field_name not in ("machine_type", "canonical_model_group")]

    def cand_dict(c) -> dict:
        return {
            "candidate_id": c.candidate_id,
            "machine_id": c.machine_id,
            "shopify_handle": c.shopify_handle,
            "brand": c.brand,
            "model": c.model,
            "field_name": c.field_name,
            "current_value": c.current_value,
            "proposed_value": c.proposed_value,
            "source_type": c.source_type,
            "source_url": c.source_url,
            "source_priority": c.source_priority,
            "confidence": f"{c.confidence:.3f}",
            "evidence_text": c.evidence_text,
            "status": c.status,
            "conflict_reason": c.conflict_reason,
        }

    common_fields = [
        "candidate_id",
        "machine_id",
        "shopify_handle",
        "brand",
        "model",
        "field_name",
        "current_value",
        "proposed_value",
        "source_type",
        "source_url",
        "source_priority",
        "confidence",
        "evidence_text",
        "status",
        "conflict_reason",
    ]

    write_csv(OUT / "machine_type_enrichment_candidates.csv", [cand_dict(c) for c in type_rows], common_fields)
    write_csv(OUT / "spec_enrichment_candidates.csv", [cand_dict(c) for c in spec_rows], common_fields)
    write_csv(
        OUT / "source_citations.csv",
        citations,
        [
            "candidate_id",
            "machine_id",
            "shopify_handle",
            "field_name",
            "source_type",
            "source_priority",
            "source_url",
            "confidence",
            "evidence_text",
        ],
    )

    if not args.no_sql:
        sql_path = OUT / "approval_import.sql"
        sql_path.write_text(generate_approval_sql(candidates, batch_id), encoding="utf-8")

    pending = sum(1 for c in candidates if c.status == "pending")
    conflicts = sum(1 for c in candidates if c.status == "conflict")
    print()
    print(f"Candidates: {len(candidates)} (pending={pending}, conflict={conflicts})")
    print(f"  machine type / family: {len(type_rows)}")
    print(f"  specs: {len(spec_rows)}")
    print(f"Wrote {OUT}/")
    print("Next: review CSVs → apply approval_import.sql on dev → approve in DB → apply-enrichment-approvals.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
