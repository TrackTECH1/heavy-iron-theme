# Heavy Iron Supply Co. — Store V1 Launch Checklist

**Target:** Dev preview on `tracktech-530.myshopify.com` first. **Production blocked** until human sign-off.

## Pre-flight (data)

- [x] Dev Supabase branch `zhdqdxtwipcowbtdyviq` is source of truth
- [x] `fleet_machine_catalog` = `active_v1` only for publish
- [x] Track size v2 spine validated (`./scripts/fitment validate-store-v1`)
- [x] Matrixify bundle generated (`./scripts/fitment export-store-v1`)
- [ ] Hero backfill wave 2+ (246/1147 have heroes — optional for scale)

## Matrixify import order (dev store only)

Import on **tracktech-530** via Matrixify Enterprise:

| Step | File | Matrixify entity | Match key |
|------|------|------------------|-----------|
| 1 | `MATRIXIFY_IMPORT_FILES/products/products_matrixify.xlsx` | Products | Variant SKU |
| 2 | `MATRIXIFY_IMPORT_FILES/metafields/product_metafields_backfill.csv` | Products | Variant SKU |
| 3 | `MATRIXIFY_IMPORT_FILES/models/model_metaobjects_matrixify.xlsx` | Metaobjects (`model`) | Handle |
| 4 | Review | `models/model_track_variants_matrixify.xlsx` | Audit only |
| 5 | Review | `media/model_media_matrixify.xlsx` | Audit only |

**Command:** MERGE for all. Do **not** import to `heavyironsupply.myshopify.com` without approval.

### API apply alternative (pilots)

```bash
./scripts/fitment apply-models --apply --handle john-deere-323e
./scripts/fitment apply-models --apply --handle kubota-svl75-2
```

## Theme preview

- [ ] Push theme branch to unpublished preview on dev store
- [ ] Verify pilot URLs:
  - https://tracktech-530.myshopify.com/pages/fitment/john-deere-323e
  - https://tracktech-530.myshopify.com/pages/fitment/kubota-svl75-2
- [ ] Hero image renders
- [ ] Track groups: wide size before narrow (400 before 320 on 323E)
- [ ] TNT variants before BS/TT within each group
- [ ] UC sections: Sprockets, Idlers, Rollers
- [ ] Attachments when `featured_attachments` populated

## My Fleet admin

- [ ] `cd my-fleet && npm run dev` — http://localhost:3000
- [ ] Search returns `active_v1` only (default)
- [ ] Machine workspace tabs: Tracks, Sprockets, Idlers, Rollers, Attachments
- [ ] `/machines/mdl_john_deere_323e` loads clean data

## Validation gates

| Gate | Command | Store V1 status |
|------|---------|-----------------|
| v2 UI | `python3 scripts/validate-track-size-v2-ui.py` | PASS |
| Publish contract | `python3 scripts/validate-store-v1.py` | PASS |
| Launch gate dev | `python3 scripts/launch-gate.py --tier dev` | PARTIAL (320x86x52, 400x86x53) |
| Theme static | `python3 scripts/validate-theme-store-v1.py` | PASS |

## Production blockers (human approval required)

1. Launch gate `launch` / `prod` tier not passing (catalog SSOT ~13% perfect 7/7)
2. Bulk hero images missing (~900 models)
3. Matrixify model import not run on production store
4. Preview theme sign-off not recorded

## Sign-off

| Role | Name | Date | Approved |
|------|------|------|----------|
| Data / My Fleet | | | |
| Shopify / Matrixify | | | |
| Theme / UX | | | |
| Production publish | | | |

## Rollback

- Matrixify: re-import previous Model metaobject export backup
- Theme: revert preview theme to prior published version
- Supabase: dev branch only — no production mutations in Store V1 pipeline
