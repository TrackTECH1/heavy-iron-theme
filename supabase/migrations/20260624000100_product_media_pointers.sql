-- Product media pointers for storefront search/model thumbnails.
-- Heavy image bytes live on Shopify CDN; Supabase stores only the selected
-- public pointers and roles used by Edge Functions.

alter table if exists public.product
  add column if not exists image_url text,
  add column if not exists image_alt text,
  add column if not exists shopify_media_id text,
  add column if not exists media_role text;

create index if not exists product_image_url_idx
  on public.product (image_url)
  where image_url is not null;

comment on column public.product.image_url is
  'Primary public image pointer, preferably Shopify CDN. Used by search/model payloads.';

comment on column public.product.image_alt is
  'Human and crawler readable alt text for the primary image.';

comment on column public.product.shopify_media_id is
  'Optional Shopify media GID for the primary product media.';

comment on column public.product.media_role is
  'Primary role for the selected image, e.g. hero, close_up, left_side, steel_cord.';
