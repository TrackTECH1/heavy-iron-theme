# Shopify Theme Test Report — Store V1
Generated: 2026-06-23 21:55 UTC
Dev store: `tracktech-530.myshopify.com`
**Production:** not tested (blocked by policy)

## Static theme analysis
- **Model metaobject page** → `main-fitment`
- **Machine fitment page** → `main-machine-fitment`

### Snippets

- ✓ `snippets/hi-track-grouped-cards.liquid`
- ✓ `snippets/hi-uc-category-sections.liquid`
- ✓ `snippets/hi-product-card.liquid`
- ✓ `snippets/hi-machine-jsonld.liquid`

### DoD field coverage (`main-fitment.liquid`)

- ✓ Hero image
- ✓ Specs
- ✓ Rubber tracks (grouped)
- ✓ Sprockets/idlers/rollers
- ✓ Attachments
- ✓ Primary track size
## Dev Shopify metaobject check

- **john-deere-323e**: hero=yes, primary_track_size=320x86Bx52, track_products≥0, uc_products≥4
  Preview URL: `https://tracktech-530.myshopify.com/pages/fitment/john-deere-323e`
- **kubota-svl75-2**: hero=yes, primary_track_size=320x86Bx52, track_products≥0, uc_products≥4
  Preview URL: `https://tracktech-530.myshopify.com/pages/fitment/kubota-svl75-2`

## Manual preview checklist

1. Push theme to unpublished preview on `tracktech-530`
2. Open `/pages/fitment/john-deere-323e` — hero, grouped tracks, UC categories
3. Confirm TNT variants appear before BS/TT within each track size group
4. Confirm wide track size group appears before narrow (400 before 320 on 323E)
5. Attachments section renders when `featured_attachments` populated
