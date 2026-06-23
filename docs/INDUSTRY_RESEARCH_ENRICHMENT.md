# Industry Research Enrichment

Improve **machine type**, **model family**, and **machine specs** using trusted sources only.  
Runs **after Store V1 blockers** are resolved — does not compete with launch-critical work (track sizes, products, images, page output).

## Principles

| Rule | Behavior |
|------|----------|
| Never guess | Only explicit values from cited sources |
| Never auto-overwrite | `core.model` unchanged until human approval |
| Source priority | OEM → dealer → brochure → Track Finder / Fitment → manual |
| Protected values | `track_finder_v1` / approved navigation rows → `conflict` status |
| Audit trail | Promotion appends `source_systems` stamp |

## Machine type taxonomy

Track Finder categories (primary):

- **Compact Track Loader** — rubber-track loader (Bobcat T-series, CAT 259, Deere 3xxG, etc.)
- **Multi-Terrain Loader** — ASV/Terex RT-style MTL
- **Mini Excavator** — excavator undercarriage
- **Skid Steer** — wheeled skid steer
- **Mini Skid Steer** — walk-behind / stand-on (manual registry only)

CTL vs MTL vs mini skid steer disambiguation requires **OEM or dealer citation** — never inferred from weight alone.

## Workflow

```bash
# 1. Apply dev schema (once)
psql "$DEV_URL" -f supabase/quality-audit/phase2/enrichment_candidates.sql

# 2. Add curated OEM/dealer/brochure rows
#    data/industry-research/oem_source_registry.csv

# 3. Generate candidates + SQL
./scripts/fitment industry-research

# 4. Review outputs in data/industry-research/
#    - industry_research_queue.csv
#    - machine_type_enrichment_candidates.csv
#    - spec_enrichment_candidates.csv
#    - source_citations.csv

# 5. Load pending rows (still does NOT update core.model)
psql "$DEV_URL" -f data/industry-research/approval_import.sql

# 6. Approve in SQL or My Fleet (fleet_enrichment_candidates view)
UPDATE core.enrichment_candidates SET status = 'approved', reviewed_by = 'you', reviewed_at = now()
WHERE candidate_id = 'enr_...';

# 7. Promote approved only
python3 scripts/apply-enrichment-approvals.py --apply
```

## Source registries

| File | Priority | Use |
|------|----------|-----|
| `oem_source_registry.csv` | 1 | OEM spec sheets / product pages |
| `dealer_spec_registry.csv` | 2 | Dealer published specs |
| `brochure_spec_registry.csv` | 3 | PDF / brochure extractions (manual) |
| Track Finder JSON | 4 | `machine_type`, family label |
| Package `core_model.csv` | 4 | Spec columns when explicitly populated |

Registry columns: `machine_id`, `field_name`, `proposed_value`, `source_url`, `confidence`, `evidence_text`.

## Fields

| Field | Notes |
|-------|-------|
| `machine_type` | Canonical taxonomy value |
| `canonical_model_group` | Brand + model family |
| `operating_weight_lbs` | Numeric |
| `horsepower` | Numeric |
| `std_gpm`, `hf_gpm`, `std_psi` | Hydraulic specs |
| `model_year_start`, `model_year_end` | Future — manual registry only |

## Launch scope

**In scope for launch:** machine type accuracy on pilot brands, track size options, products, images, page output.

**Post-V1 / enrichment:** bulk spec backfill, year ranges, CTL/MTL edge cases without OEM proof.

## Related

- `fleet_enrichment_tasks` — deterministic gap detection (read-only)
- `fleet_enrichment_candidates` — approval queue (this workflow)
- `scripts/apply-enrichment-approvals.py` — promotion after approval
