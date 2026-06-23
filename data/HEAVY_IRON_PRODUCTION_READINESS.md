# Heavy Iron Production Readiness

## Current Status

The catalog is usable, but the correct production path is to treat Supabase as the master data source and Shopify as the sales channel. The core relationship spine is solid: models, products, and fitments are connected cleanly enough to power the control center and storefront pages.

## What Must Stay True

- `product.id` is the internal master key.
- `product_code` is the stable internal catalog code.
- `sku` is the sellable/store-facing SKU.
- `itemid` is the supplier/source item identity when present.
- Shopify product and variant IDs are channel identifiers, not master identity.
- Machine pages should be powered by `model` plus `fitment`, not by duplicate product rows for every machine phrase.

## Production Cleanup Queue

1. Resolve duplicate SKU groups by choosing one canonical sellable product row per SKU.
2. Backfill missing `machine_type_code` values from existing model/machine context.
3. Decide inventory grain: SKU/warehouse or product/warehouse rollup.
4. Reconcile orphaned inventory, image, pricing, and Shopify mapping references.
5. Fill product publish requirements: SKU, part type, track size for tracks, Shopify product ID, Shopify variant ID.
6. Keep generated landing-page content separate from canonical sellable products.
7. Re-run the quality views after each import or Shopify sync.

## Added Audit Views

The migration `supabase/migrations/20260623090000_catalog_quality_views.sql` adds read-only views for:

- admin machine summaries
- admin product summaries
- inventory rollups by product and warehouse
- catalog quality metric counts
- duplicate SKU queues
- product publish readiness
- orphaned references

These views are safe for dashboard use because they do not mutate data. Apply them to production only after reviewing the migration against the live schema.

## Storefront Readiness

The theme now pulls Supabase Edge Function endpoints from theme settings and fails closed when an endpoint is blank. No secret keys belong in the Shopify theme. Public storefront calls should hit Edge Functions only, and those functions should enforce their own validation/rate limits before reading Supabase.
