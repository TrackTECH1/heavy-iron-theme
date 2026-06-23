# Full Store Audit Report — Heavy Iron Supply Co.

**Generated:** 2026-06-23 22:28 UTC  
**Environment:** Dev Supabase + `tracktech-530.myshopify.com`  
**Overall:** **PASS**

---

## Executive summary

| Area | Metric |
|------|--------|
| Active machines (`active_v1`) | 1147 |
| Machines with Shopify path | 1147 |
| Publish contract ready | 930 |
| Publish blocked | 187 |
| Missing hero | 99 |
| v2 spine sizes | 128 (dirty: 0) |
| Fitment pass (machine) | 938/1147 |
| Products in Products.csv | 622 (pass: 546) |
| My Fleet admin pages | 11/11 |
| Matrixify bundle | yes |

## Checklist vs Definition of Done

- ✓ Every active machine has valid page path
- ✓ Every active machine has track-size options
- ✓ Every track size has products or review warning
- ✓ Published products have title/SKU/price/image
- ✓ Menus link to valid targets
- ✓ Collections contain products
- ✓ Machine pages render tracks + UC tabs
- ✓ Search configured
- ✓ PDP fitment selector
- ✓ No dirty parser sizes in spine
- ✓ No quarantine in publish
- ✓ TNT primary / wide before narrow
- ✓ track_size_v2 only
- ✓ Matrixify bundle ready
- ✓ My Fleet admin complete
- ✓ Fitment coverage ≥75% pass
- ✓ Blocked machines ≤200
- ✓ Hero coverage ≤300 missing

## Output files

- `PAGE_COMPLETION_REPORT.csv`
- `MENU_NAVIGATION_AUDIT.csv`
- `COLLECTION_AUDIT.csv`
- `PRODUCT_COMPLETION_AUDIT.csv`
- `METAOBJECT_MODEL_AUDIT.csv`
- `IMAGE_COVERAGE_AUDIT.csv`
- `FITMENT_COVERAGE_AUDIT.csv`
- `SEO_AUDIT.csv`
- `THEME_TEMPLATE_AUDIT.md`
- `MATRIXIFY_EXPORT_VALIDATION.md`
- `FIX_PLAN.md`
- `STORE_V1_GO_LIVE_CHECKLIST.md`

## Blockers

1. Matrixify model import on dev store not yet verified end-to-end.
2. Catalog SSOT launch gate not passing on all curated sizes.
3. **187 blocked machines** — no v2 products or missing primary track size.
4. **99 machines** missing hero image.
5. Dev Model metaobject `track_products` field — Matrixify import required.
6. **Production** — no changes without approval.

See `FIX_PLAN.md` for prioritized remediation.
