-- Per-model hero images for headless storefront (synced from Shopify model metaobjects).
alter table public.model
  add column if not exists hero_image_path text,
  add column if not exists hero_image_alt text,
  add column if not exists hero_source_url text,
  add column if not exists hero_image_synced_at timestamptz;

comment on column public.model.hero_image_path is
  'Public storage path, e.g. bobcat-t730-hero.webp in machine-images bucket';
comment on column public.model.hero_source_url is
  'Shopify CDN URL last synced from — skip re-upload when unchanged';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'machine-images',
  'machine-images',
  true,
  5242880,
  array['image/webp', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy if not exists "Public read machine-images"
  on storage.objects for select
  using (bucket_id = 'machine-images');
