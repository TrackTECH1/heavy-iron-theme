-- Store the resolved Shopify storefront handle on the product row.
--
-- Why: catalog-search currently falls back to an unauthenticated N+1 Shopify Admin API
-- fan-out (up to ~24 concurrent Admin calls per public request) to turn a product into a
-- /products/<handle> URL. Persisting the resolved handle lets the read path map to a URL
-- with a pure DB read. Populated by scripts/backfill-shopify-product-ids.py.
--
-- Additive + safe: nullable column, partial index. To roll back:
--   drop index if exists public.product_shopify_handle_idx;
--   alter table public.product drop column if exists shopify_handle;

alter table if exists public.product
  add column if not exists shopify_handle text;

create index if not exists product_shopify_handle_idx
  on public.product (shopify_handle)
  where shopify_handle is not null;

comment on column public.product.shopify_handle is
  'Resolved Shopify storefront product handle (populated by backfill-shopify-product-ids / sync). Used to build /products/<handle> URLs without a Shopify Admin API call.';
