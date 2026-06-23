# Store V1 Fix Plan

Prioritized fixes for launch readiness (dev first).

### P0: Matrixify import on tracktech-530

products → metafields → model metaobjects from MATRIXIFY_IMPORT_FILES/

### P0: Dev Model MO field definition

Ensure `track_products`, `uc_products`, `hero_image`, `approved_track_sizes` exist on dev store

### P0: Catalog SSOT launch gate

Fix 320x86x52 and 400x86x53 product alignment — run validate-catalog-ssot per size

### P1: Hero backfill

~99 models missing hero — fleet_enrichment_tasks + fleet_model_hero

### P1: Blocked machines

187 machines blocked (no products or non-v2 primary) — review in My Fleet

### P1: Product images

61 Products.csv rows missing Image Src

### P2: SEO metaobjects

Run generate-model-seo-csv.py + Matrixify import for top machines

### P2: Collection completeness

Verify undercarriage/sprockets/idlers/rollers collections populated on dev

### P2: Menu audit live

Re-run audit with Shopify CLI after menu changes

### P3: Redirects

No redirect config in theme repo — configure in Shopify Admin if needed

### P3: Attachments on Model MO

Export featured_attachments when attachment catalog certified

