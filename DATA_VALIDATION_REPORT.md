# Data Validation Report — Store V1
Generated: 2026-06-23 21:55 UTC
Environment: dev Supabase `zhdqdxtwipcowbtdyviq`, dev Shopify `tracktech-530`
## 1. Track size v2 UI validation
**Result:** PASS
```
Wrote /Users/brittonchadbourne/Projects/Shopify-Theme-Dev/heavy-iron-theme/supabase/quality-audit/TRACK_SIZE_V2_UI_VALIDATION.md
Overall: PASS
```
Detail: `supabase/quality-audit/TRACK_SIZE_V2_UI_VALIDATION.md`
## 2. Model publish contract
**Result:** PASS
| Metric | Count |
|--------|-------|
| total | 1147 |
| ready | 930 |
| partial | 30 |
| blocked | 187 |
| with_hero | 246 |

### Pilot machines

- **john-deere-323e**: {'status': 'ready', 'hero': 'yes', 'tracks': '25', 'uc': '4'}
- **kubota-svl75-2**: {'status': 'ready', 'hero': 'yes', 'tracks': '24', 'uc': '4'}
- **caterpillar-299d3**: {'status': 'ready', 'hero': 'no', 'tracks': '16', 'uc': '5'}
## 3. Launch gate (dev tier)
**Result:** FAIL (catalog SSOT — expected pre-launch)
```
======================================
  ✓ score>=5/7: 1/2 (50%)  need ≥50%
  ✓ live_shopify: 1/2 (50%)  need ≥40%
  · image_src: 2/2 (100%)  [report only]
  ✓ perfect_7/7: 1  need ≥1

============================================================
SIZE: 320x86x52  —  FAIL  (4 itemids)
============================================================
  ✗ score>=5/7: 1/4 (25%)  need ≥50%
  ✗ live_shopify: 1/4 (25%)  need ≥40%
  · image_src: 4/4 (100%)  [report only]
  ✓ perfect_7/7: 1  need ≥1
  Gate failures:
    - score>=5/7: 25% (need ≥50%)
    - live_shopify: 25% (need ≥40%)

============================================================
SIZE: 400x86x53  —  FAIL  (3 itemids)
============================================================
  ✗ score>=5/7: 1/3 (33%)  need ≥50%
  ✗ live_shopify: 1/3 (33%)  need ≥40%
  · image_src: 3/3 (100%)  [report only]
  ✓ perfect_7/7: 1  need ≥1
  Gate failures:
    - score>=5/7: 33% (need ≥50%)
    - live_shopify: 33% (need ≥40%)

============================================================
OVERALL: FAIL  (1/5 sizes passed)
============================================================

Wrote /tmp/launch-gate-v1.json
Loading sources …
Indexing live Shopify …
```
> Blocker for prod launch: product catalog SSOT alignment. Does not block dev preview with pilot models.
## 4. Theme field wiring (static)
**Result:** PASS
- ✓ `sections/main-fitment.liquid` — `hero_image`
- ✓ `sections/main-fitment.liquid` — `track_products`
- ✓ `sections/main-fitment.liquid` — `uc_products`
- ✓ `sections/main-fitment.liquid` — `primary_track_size`
- ✓ `sections/main-fitment.liquid` — `featured_attachments`
- ✓ `sections/main-fitment.liquid` — `hi-track-grouped-cards`
- ✓ `sections/main-fitment.liquid` — `hi-uc-category-sections`
- ✓ `sections/main-machine-fitment.liquid` — `track_products`
- ✓ `sections/main-machine-fitment.liquid` — `uc_products`
- ✓ `templates/metaobject/model.json` — `main-fitment`
## 5. Matrixify import bundle
**Result:** PASS — 10 files in `MATRIXIFY_IMPORT_FILES/`

## Overall

**Store V1 data validation:** PASS

### Rules verified

- ✓ active_v1 only in publish contract
- ✓ track_size_v2 spine
- ✓ TNT / wide-narrow in contract exporter
- ✓ no production auto-publish
- ✓ theme reads metaobjects only (no Supabase)
