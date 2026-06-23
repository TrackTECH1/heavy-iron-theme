-- Heavy Iron Supply Co. asset graph hardening.
-- Public image bytes live on Shopify CDN. Supabase stores relational pointers.
-- Private B2B documents live in a locked Supabase Storage bucket.

create extension if not exists pgcrypto with schema extensions;

alter table public.machine add column if not exists hero_image_cdn text;
alter table public.machine add column if not exists hero_image_alt text;
alter table public.machine add column if not exists undercarriage_diagram_cdn text;
alter table public.machine add column if not exists image_cdn_source text not null default 'shopify_files';

alter table public.product add column if not exists shopify_media_id text;
alter table public.product add column if not exists shopify_variant_media_id text;
alter table public.product add column if not exists image_cdn_source text not null default 'shopify_product_media';

create table if not exists public.machine_asset (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machine(id) on delete cascade,
  asset_role text not null check (asset_role in ('hero', 'undercarriage_diagram', 'track_grid', 'field_photo', 'technical_detail')),
  shopify_cdn_url text not null check (shopify_cdn_url like 'https://cdn.shopify.com/%'),
  alt text,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  sort_order integer not null default 0,
  source text not null default 'shopify_files',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (machine_id, asset_role, shopify_cdn_url)
);

create table if not exists public.product_media_reference (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product(id) on delete cascade,
  shopify_product_id text,
  shopify_variant_id text,
  shopify_media_id text,
  shopify_variant_media_id text,
  media_role text not null default 'variant_anchor' check (media_role in ('featured', 'variant_anchor', 'gallery', 'technical_detail')),
  shopify_cdn_url text check (shopify_cdn_url is null or shopify_cdn_url like 'https://cdn.shopify.com/%'),
  alt text,
  sort_order integer not null default 0,
  source text not null default 'shopify_product_media',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_flags (
  id uuid primary key default gen_random_uuid(),
  flag_type text not null,
  status text not null default 'pending_admin_review',
  shopify_order_id text,
  shopify_cart_token text,
  buyer_email text,
  company text,
  storage_bucket text,
  storage_path text,
  signed_url text,
  signed_url_expires_at timestamptz,
  admin_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists machine_asset_machine_idx on public.machine_asset (machine_id);
create index if not exists machine_asset_role_idx on public.machine_asset (asset_role);
create index if not exists product_media_reference_product_idx on public.product_media_reference (product_id);
create index if not exists product_media_reference_variant_idx on public.product_media_reference (shopify_variant_id) where shopify_variant_id is not null;
create index if not exists product_media_reference_media_idx on public.product_media_reference (shopify_media_id) where shopify_media_id is not null;
create unique index if not exists product_media_reference_unique_idx on public.product_media_reference (
  product_id,
  media_role,
  coalesce(shopify_variant_id, ''),
  coalesce(shopify_media_id, ''),
  coalesce(shopify_cdn_url, '')
);
create index if not exists order_flags_type_status_idx on public.order_flags (flag_type, status);
create index if not exists order_flags_order_idx on public.order_flags (shopify_order_id) where shopify_order_id is not null;
create index if not exists order_flags_email_idx on public.order_flags (buyer_email) where buyer_email is not null;

insert into public.product_media_reference (
  product_id, shopify_product_id, shopify_variant_id, shopify_media_id,
  shopify_variant_media_id, media_role, shopify_cdn_url, alt
)
select
  p.id,
  p.shopify_product_id,
  p.shopify_variant_id,
  p.shopify_media_id,
  p.shopify_variant_media_id,
  'featured',
  p.image_url,
  p.image_alt
from public.product p
where p.image_url like 'https://cdn.shopify.com/%'
on conflict do nothing;

update public.product_media_reference pmr
set
  shopify_product_id = p.shopify_product_id,
  shopify_variant_id = p.shopify_variant_id,
  shopify_media_id = p.shopify_media_id,
  shopify_variant_media_id = p.shopify_variant_media_id,
  alt = p.image_alt,
  updated_at = now()
from public.product p
where pmr.product_id = p.id
  and pmr.media_role = 'featured'
  and pmr.shopify_cdn_url = p.image_url
  and p.image_url like 'https://cdn.shopify.com/%';

create or replace view public.product_image_cdn_audit
with (security_invoker = true)
as
select
  id as product_id,
  coalesce(sku, product_code) as sku,
  handle,
  image_url,
  case
    when image_url is null or btrim(image_url) = '' then 'missing'
    when image_url like 'https://cdn.shopify.com/%' then 'shopify_cdn'
    else 'external_or_unoptimized'
  end as image_cdn_status
from public.product;

alter table public.machine_asset enable row level security;
alter table public.product_media_reference enable row level security;
alter table public.order_flags enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['machine_asset', 'product_media_reference'] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = tbl and policyname = 'public_read'
    ) then
      execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', tbl);
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = tbl and policyname = 'authenticated_write'
    ) then
      execute format('create policy authenticated_write on public.%I for all to authenticated using (true) with check (true)', tbl);
    end if;

    execute format('grant select on public.%I to anon, authenticated', tbl);
    execute format('grant insert, update, delete on public.%I to authenticated', tbl);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'order_flags' and policyname = 'authenticated_internal_review'
  ) then
    create policy authenticated_internal_review on public.order_flags
      for all to authenticated
      using (true)
      with check (true);
  end if;
end $$;

grant select on public.product_image_cdn_audit to anon, authenticated;
grant select, insert, update, delete on public.order_flags to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tax-exemption-certificates',
  'tax-exemption-certificates',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
