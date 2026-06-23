# Store V1 Completion Report — Heavy Iron Supply Co.

**Date:** 2026-06-23  
**Branch:** `cursor/faster-fitment-backfill-and-auto-key`  
**Environment:** Dev only (`zhdqdxtwipcowbtdyviq` / `tracktech-530`)

## Architecture (unchanged)

```
Supabase clean dev/core (source of truth)
        ↓
My Fleet (admin · QA · media · content studio)
        ↓
Matrixify / Shopify Admin API (publish pipe)
        ↓
Heavy Iron Shopify theme (storefront shell — metaobjects/products only)
```

No live Supabase calls from the storefront theme.

---

## Definition of Done — Status

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | My Fleet works as internal admin | **DONE** | Next.js app `my-fleet/` — search, machine workspace, category tabs, QA, enrichment |
| 2 | Active machines only show clean data | **DONE** | `getMachine()` → `fleet_machine_catalog`; publish uses `active_v1` |
| 3 | Track sizes use track_size_v2 only | **DONE** | `filterV2QaParts`, v2 spine — `TRACK_SIZE_V2_UI_VALIDATION.md` PASS |
| 4 | TNT is primary/default | **DONE** | My Fleet tier filter + contract sort + theme TNT-first variant loop |
| 5 | Wide before narrow | **DONE** | `fleet_machine_track_size_options.display_priority` + contract exporter |
| 6 | Machine pages show full fitment | **DONE*** | Theme: hero, specs, grouped tracks, UC categories, attachments (*needs MO data on Shopify) |
| 7 | Images mapped machine / track / product | **DONE** | Media layer views + `model_media_matrixify.xlsx` (25,933 rows) |
| 8 | Matrixify exports generated | **DONE** | `MATRIXIFY_IMPORT_FILES/` — 10 files |
| 9 | Preview theme renders approved data | **PARTIAL** | Static PASS; Matrixify model import required (`track_products` field on dev MO) |
| 10 | No quarantine/reference/review publishes | **DONE** | `fleet_machine_catalog` filter in contract |
| 11 | Final validation report passes | **PASS** | `DATA_VALIDATION_REPORT.md` |

**Store V1 overall:** **COMPLETE for dev/staging pipeline** — production launch gated on catalog SSOT + human approval.

---

## Major steps completed this session

### 1. Media layer
- Already committed; fleet media views (`fleet_model_hero`, `fleet_track_size_media`, `fleet_product_media`)
- Export includes 25,933 media audit rows

### 2. My Fleet machine workspace
- Category tabs: Tracks, Sprockets, Front/Rear Idlers, Rollers, Attachments, OEM Refs
- **Fix:** `getMachine()` now reads `fleet_machine_catalog` (active_v1 only)

### 3. Category tabs (theme parity)
- **New:** `snippets/hi-track-grouped-cards.liquid` — groups by track size, TNT variants first
- **New:** `snippets/hi-uc-category-sections.liquid` — sprockets / idlers / rollers sections
- **Updated:** `sections/main-fitment.liquid`, `assets/hi-machine.css`

### 4. Matrixify publish contract
- `scripts/lib/model_publish_contract.py` — TNT-first, wide→narrow, v2 filter
- Adds `approved_track_sizes` metaobject field to export

### 5. Matrixify-ready files
- **Orchestrator:** `scripts/export-store-v1-bundle.py` → `./scripts/fitment export-store-v1`

### 6. Theme verification
- **Script:** `scripts/validate-theme-store-v1.py`
- Report: `SHOPIFY_THEME_TEST_REPORT.md`

### 7. Validation suite
- **Script:** `scripts/validate-store-v1.py`
- Report: `DATA_VALIDATION_REPORT.md` — **PASS**

### 8. Launch checklist
- `LAUNCH_CHECKLIST.md`

---

## Files changed (Store V1 slice)

| Area | Files |
|------|-------|
| My Fleet | `my-fleet/src/lib/queries.ts`, `my-fleet/src/app/fitments/page.tsx` |
| Theme | `sections/main-fitment.liquid`, `snippets/hi-track-grouped-cards.liquid`, `snippets/hi-uc-category-sections.liquid`, `assets/hi-machine.css` |
| Publish | `scripts/lib/model_publish_contract.py`, `scripts/export-store-v1-bundle.py` |
| Validation | `scripts/validate-store-v1.py`, `scripts/validate-theme-store-v1.py` |
| Outputs | `MATRIXIFY_IMPORT_FILES/`, `DATA_VALIDATION_REPORT.md`, `SHOPIFY_THEME_TEST_REPORT.md`, `LAUNCH_CHECKLIST.md` |
| CLI | `scripts/fitment` — `export-store-v1`, `validate-store-v1`, `validate-theme` |

---

## Validation results

| Check | Result |
|-------|--------|
| Track size v2 UI | **PASS** (128 spine sizes) |
| Publish contract | **PASS** (930 ready / 1147 active_v1) |
| Launch gate dev | **FAIL** 1/5 sizes (catalog SSOT — pre-launch expected) |
| Theme static wiring | **PASS** (10/10 checks) |
| Matrixify bundle | **PASS** (10 files) |

### Pilot machines

| Handle | Contract | Dev MO (API) |
|--------|----------|--------------|
| john-deere-323e | ready, hero, 25 tracks, 4 UC | hero=yes, UC≥4, tracks pending import |
| kubota-svl75-2 | ready, hero, 24 tracks, 4 UC | hero=yes, UC≥4, tracks pending import |
| caterpillar-299d3 | ready, no hero, 16 tracks | hero=no |

---

## Blockers

1. **Catalog SSOT** — launch gate fails on `320x86x52`, `400x86x53` (product alignment, not machine layer)
2. **Dev Model metaobject fields** — API apply failed: `track_products` field definition missing on dev store; use Matrixify import from `model_metaobjects_matrixify.xlsx`
3. **Hero coverage** — 246/1147 models have heroes
4. **Production** — explicitly blocked; no auto-publish

---

## Next actions (human)

1. Matrixify import on **tracktech-530** per `LAUNCH_CHECKLIST.md`
2. Push theme to preview; visual check pilot URLs
3. Fix catalog SSOT for launch-tier sizes before prod
4. Hero backfill via `fleet_enrichment_tasks` / media layer

---

## Commands reference

```bash
./scripts/fitment export-store-v1      # Regenerate MATRIXIFY_IMPORT_FILES/
./scripts/fitment validate-store-v1    # DATA_VALIDATION_REPORT.md
./scripts/fitment validate-theme --shopify-check
./scripts/fitment apply-models --apply --handle john-deere-323e
cd my-fleet && npm run dev             # My Fleet admin
```

**No production Supabase or live Shopify mutations were performed.**
