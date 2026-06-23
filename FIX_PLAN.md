# Store V1 Fix Plan

Prioritized fixes for launch readiness (dev first). From full audit **2026-06-23** — overall **FAIL** (3 DoD gates).

## Failed DoD gates

1. **88 machines** missing `fleet_machine_track_size_options`
2. **Product publish** — 373/622 pass (60%); need ≥85%
3. **Hero coverage** — 901 missing (threshold ≤300)

---

### P0: Track size options (88 machines)

Add `fleet_machine_track_size_options` rows for machines missing approved sizes — re-run `import-track-finder-navigation.py` or enrich via My Fleet.

### P0: Matrixify import on tracktech-530

Import order: `products_matrixify.xlsx` → `product_metafields_backfill.csv` → `model_metaobjects_matrixify.xlsx`

Ensure dev Model metaobject has fields: `track_products`, `uc_products`, `hero_image`, `approved_track_sizes`.

### P0: Catalog SSOT launch gate

Fix `320x86x52` and `400x86x53` product alignment:

```bash
./scripts/fitment validate --track-size 320x86x52
./scripts/fitment launch-gate --tier dev
```

### P1: Hero backfill (901 machines)

Use `fleet_enrichment_tasks` + `fleet_model_hero` — prioritize launch brands/pilots first.

### P1: Blocked machines (187)

Review in My Fleet — `missing_primary_track_size_v2` or `no_products`. Do not publish.

### P1: Product images (249 review rows)

Cross-reference `IMAGE_COVERAGE_AUDIT.csv` with media layer / supplier TSV.

### P2: SEO metaobjects

Run `generate-model-seo-csv.py` + Matrixify import for top 50 models.

### P2: Collection completeness

Verify undercarriage/sprockets/idlers/rollers collections on dev store.

### P2: End-to-end preview verification

After Matrixify import, re-run:

```bash
./scripts/fitment audit-store
./scripts/fitment validate-theme --shopify-check
```

### P3: Redirects

No redirect config in theme repo — configure in Shopify Admin if URL migrations needed.

### P3: Attachments on Model MO

Export `featured_attachments` when attachment catalog is certified.

---

## Re-audit command

```bash
./scripts/fitment audit-store
```

Target: **FULL_STORE_AUDIT_REPORT.md** overall **PASS**.
