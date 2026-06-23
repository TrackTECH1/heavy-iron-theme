-- Heavy Iron Supply Co. production normalization contract.
-- Additive only: keeps existing product/model/fitment contracts intact.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'tread_pattern'
      and t.typtype = 'e'
  )
  and not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'tread_pattern'
  )
  and not exists (
    select 1
    from information_schema.columns
    where udt_schema = 'public'
      and udt_name = 'tread_pattern'
  ) then
    alter type public.tread_pattern rename to tread_pattern_enum;
  end if;
end $$;

create or replace function public.normalize_heavy_iron_query(q text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select btrim(
    regexp_replace(
      regexp_replace(lower(coalesce(q, '')), '([a-z])([0-9])', '\1 \2', 'g'),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

alter table public.product add column if not exists base_price numeric;
alter table public.product add column if not exists gtin text;
update public.product set base_price = price where base_price is null and price is not null;
create index if not exists product_sku_idx on public.product (sku) where sku is not null;
create index if not exists product_gtin_idx on public.product (gtin) where gtin is not null;

create table if not exists public.machine_type (
  code text primary key,
  label text not null,
  category text not null default 'heavy_equipment',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.machine (
  id uuid primary key default gen_random_uuid(),
  model_id uuid unique references public.model(id) on delete set null,
  make text not null,
  model text not null,
  model_key text unique,
  machine_type_code text references public.machine_type(code) on update cascade,
  year_start integer check (year_start is null or year_start between 1900 and 2100),
  year_end integer check (year_end is null or year_end between 1900 and 2100),
  serial_range text,
  operating_weight_lb numeric,
  hydraulic_flow_gpm numeric,
  high_flow_gpm numeric,
  search_text text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tread_pattern (
  code text primary key,
  label text not null,
  vocation_mapping text[] not null default '{}',
  terrain_mapping text[] not null default '{}',
  climate_mapping text[] not null default '{}',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.track_spec (
  id uuid primary key default gen_random_uuid(),
  product_id uuid unique references public.product(id) on delete cascade,
  sku text,
  track_size text,
  width_mm numeric check (width_mm is null or width_mm > 0),
  width_in numeric,
  pitch_mm numeric check (pitch_mm is null or pitch_mm > 0),
  pitch_type text,
  link_count integer check (link_count is null or link_count > 0),
  guide_type text,
  tread_pattern_code text references public.tread_pattern(code) on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fitment add column if not exists machine_id uuid references public.machine(id) on delete cascade;
alter table public.fitment add column if not exists product_sku text;

create table if not exists public.attachment_fitment (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machine(id) on delete cascade,
  product_id uuid not null references public.product(id) on delete cascade,
  product_sku text,
  attachment_category text,
  mount_type text,
  min_machine_weight_lb numeric,
  max_machine_weight_lb numeric,
  min_hydraulic_flow_gpm numeric,
  max_hydraulic_flow_gpm numeric,
  confidence_score numeric not null default 0.75 check (confidence_score >= 0 and confidence_score <= 1),
  notes text,
  source text not null default 'controlled_rule',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (machine_id, product_id)
);

create table if not exists public.oem_cross_reference (
  id uuid primary key default gen_random_uuid(),
  oem_part_number text not null,
  normalized_oem_part_number text generated always as (lower(regexp_replace(oem_part_number, '[^a-zA-Z0-9]+', '', 'g'))) stored,
  product_id uuid references public.product(id) on delete cascade,
  product_sku text,
  manufacturer text,
  supersedes text[],
  superseded_by text[],
  confidence_score numeric not null default 0.80 check (confidence_score >= 0 and confidence_score <= 1),
  notes text,
  source text not null default 'product_catalog',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_oem_part_number, product_sku)
);

create index if not exists machine_make_model_idx on public.machine (lower(make), lower(model));
create index if not exists machine_model_key_idx on public.machine (model_key);
create index if not exists machine_machine_type_idx on public.machine (machine_type_code);
create index if not exists track_spec_size_idx on public.track_spec (track_size);
create index if not exists track_spec_dimensions_idx on public.track_spec (width_mm, pitch_mm, link_count);
create index if not exists track_spec_tread_idx on public.track_spec (tread_pattern_code);
create index if not exists fitment_machine_id_idx on public.fitment (machine_id);
create index if not exists fitment_product_sku_idx on public.fitment (product_sku);
create index if not exists attachment_fitment_machine_idx on public.attachment_fitment (machine_id);
create index if not exists attachment_fitment_product_idx on public.attachment_fitment (product_id);
create index if not exists attachment_fitment_category_idx on public.attachment_fitment (attachment_category);
create index if not exists oem_cross_reference_normalized_idx on public.oem_cross_reference (normalized_oem_part_number);
create index if not exists oem_cross_reference_product_idx on public.oem_cross_reference (product_id);
create index if not exists inventory_warehouse_id_idx on public.inventory (warehouse_id);

alter table public.machine enable row level security;
alter table public.machine_type enable row level security;
alter table public.track_spec enable row level security;
alter table public.tread_pattern enable row level security;
alter table public.attachment_fitment enable row level security;
alter table public.oem_cross_reference enable row level security;
alter table public.product enable row level security;
alter table public.fitment enable row level security;
alter table public.inventory enable row level security;
alter table public.catalog_embeddings enable row level security;

-- Seed canonical lookup tables and derivative normalized tables from the
-- existing live source tables.
insert into public.machine_type (code, label, category, description)
values
  ('compact_track_loader', 'Compact Track Loader', 'tracked_machine', 'Rubber-track compact loaders and CTLs.'),
  ('skid_steer', 'Skid Steer Loader', 'wheeled_machine', 'Wheeled skid steer loader equipment.'),
  ('mini_excavator', 'Mini Excavator', 'tracked_machine', 'Compact excavators using rubber tracks.'),
  ('crawler_carrier', 'Crawler Carrier', 'tracked_machine', 'Tracked carriers and dumpers.'),
  ('multi_terrain_loader', 'Multi Terrain Loader', 'tracked_machine', 'Low-ground-pressure tracked loaders.')
on conflict (code) do update set
  label = excluded.label,
  category = excluded.category,
  description = excluded.description,
  updated_at = now();

insert into public.machine_type (code, label, category, description)
select distinct
  lower(regexp_replace(btrim(machine_type_code), '[^a-zA-Z0-9]+', '_', 'g')),
  initcap(replace(btrim(machine_type_code), '_', ' ')),
  'heavy_equipment',
  'Imported from existing model.machine_type_code.'
from public.model
where machine_type_code is not null and btrim(machine_type_code) <> ''
on conflict (code) do nothing;

insert into public.machine (
  id, model_id, make, model, model_key, machine_type_code, serial_range,
  operating_weight_lb, hydraulic_flow_gpm, high_flow_gpm, search_text, verified,
  created_at, updated_at
)
select
  m.id,
  m.id,
  m.make,
  m.model,
  m.model_key,
  lower(regexp_replace(btrim(m.machine_type_code), '[^a-zA-Z0-9]+', '_', 'g')),
  m.serial_ranges,
  m.operating_weight_lb,
  m.hydraulic_flow_gpm,
  m.high_flow_gpm,
  coalesce(m.search_text, concat_ws(' ', m.make, m.model, m.model_key, m.machine_type_code)),
  coalesce(m.verified, false),
  coalesce(m.created_at, now()),
  coalesce(m.updated_at, now())
from public.model m
on conflict (id) do update set
  model_id = excluded.model_id,
  make = excluded.make,
  model = excluded.model,
  model_key = excluded.model_key,
  machine_type_code = excluded.machine_type_code,
  serial_range = excluded.serial_range,
  operating_weight_lb = excluded.operating_weight_lb,
  hydraulic_flow_gpm = excluded.hydraulic_flow_gpm,
  high_flow_gpm = excluded.high_flow_gpm,
  search_text = excluded.search_text,
  verified = excluded.verified,
  updated_at = now();

insert into public.tread_pattern (code, label, vocation_mapping, terrain_mapping, climate_mapping, description)
select distinct
  lower(regexp_replace(btrim(tread_pattern), '[^a-zA-Z0-9]+', '_', 'g')),
  btrim(tread_pattern),
  case
    when lower(tread_pattern) similar to '%(z|max|zig|mud)%' then array['excavation','forestry','wet_site_work']::text[]
    when lower(tread_pattern) similar to '%(multi|snow|bar)%' then array['snow_removal','winter_operations']::text[]
    when lower(tread_pattern) similar to '%(c.block|c block|demolition|mx)%' then array['demolition','paving','hard_surface']::text[]
    when lower(tread_pattern) similar to '%(stagger|turf)%' then array['landscaping','turf_sensitive_work']::text[]
    else array['general_construction']::text[]
  end,
  case
    when lower(tread_pattern) similar to '%(z|max|zig|mud)%' then array['mud','clay','swamp','loose_soil']::text[]
    when lower(tread_pattern) similar to '%(multi|snow|bar)%' then array['snow','ice','slush']::text[]
    when lower(tread_pattern) similar to '%(c.block|c block|demolition|mx)%' then array['asphalt','concrete','rock','gravel']::text[]
    when lower(tread_pattern) similar to '%(stagger|turf)%' then array['turf','finished_lawn','dry_soil']::text[]
    else array['dirt','clay','gravel','mixed']::text[]
  end,
  case
    when lower(tread_pattern) similar to '%(multi|snow|bar)%' then array['winter','freeze_thaw']::text[]
    when lower(tread_pattern) similar to '%(z|max|zig|mud)%' then array['wet','high_precipitation']::text[]
    else array['all_season']::text[]
  end,
  'Generated from existing product.tread_pattern catalog values.'
from public.product
where tread_pattern is not null and btrim(tread_pattern) <> ''
on conflict (code) do update set
  label = excluded.label,
  vocation_mapping = excluded.vocation_mapping,
  terrain_mapping = excluded.terrain_mapping,
  climate_mapping = excluded.climate_mapping,
  description = excluded.description,
  updated_at = now();

insert into public.track_spec (
  product_id, sku, track_size, width_mm, width_in, pitch_mm, pitch_type,
  link_count, guide_type, tread_pattern_code
)
select
  p.id,
  p.sku,
  p.track_size,
  p.width_mm,
  case when p.width_mm is not null then round((p.width_mm / 25.4)::numeric, 2) else null end,
  p.pitch_mm,
  nullif((regexp_match(coalesce(p.track_size, ''), '[0-9]+x[0-9]+([A-Za-z]+)x[0-9]+'))[1], ''),
  p.links,
  p.guide_type,
  lower(regexp_replace(btrim(p.tread_pattern), '[^a-zA-Z0-9]+', '_', 'g'))
from public.product p
where p.track_size is not null
   or p.width_mm is not null
   or p.pitch_mm is not null
   or p.links is not null
on conflict (product_id) do update set
  sku = excluded.sku,
  track_size = excluded.track_size,
  width_mm = excluded.width_mm,
  width_in = excluded.width_in,
  pitch_mm = excluded.pitch_mm,
  pitch_type = excluded.pitch_type,
  link_count = excluded.link_count,
  guide_type = excluded.guide_type,
  tread_pattern_code = excluded.tread_pattern_code,
  updated_at = now();

update public.fitment f
set machine_id = coalesce(f.machine_id, m.id),
    product_sku = coalesce(f.product_sku, p.sku, p.product_code)
from public.machine m, public.product p
where f.model_id = m.model_id
  and f.product_id = p.id
  and (f.machine_id is null or f.product_sku is null);

insert into public.attachment_fitment (
  machine_id, product_id, product_sku, attachment_category, mount_type,
  confidence_score, notes, source
)
select distinct
  coalesce(f.machine_id, ma.id),
  p.id,
  coalesce(p.sku, p.product_code),
  coalesce(p.attachment_category, p.part_type, p.type),
  null,
  case when f.fit_type = 'attachment' then 0.95 else 0.70 end,
  coalesce(f.notes, 'Generated from existing fitment/product attachment fields.'),
  coalesce(f.source, 'existing_fitment')
from public.fitment f
join public.product p on p.id = f.product_id
join public.machine ma on ma.model_id = f.model_id
where f.fit_type = 'attachment'
   or lower(coalesce(p.type, '')) = 'attachment'
   or lower(coalesce(p.part_type, '')) like '%attachment%'
   or p.attachment_category is not null
on conflict (machine_id, product_id) do update set
  product_sku = excluded.product_sku,
  attachment_category = excluded.attachment_category,
  confidence_score = excluded.confidence_score,
  notes = excluded.notes,
  source = excluded.source,
  updated_at = now();

insert into public.oem_cross_reference (
  oem_part_number, product_id, product_sku, manufacturer,
  confidence_score, notes, source
)
select distinct
  btrim(coalesce(p.oem_part_number, p.part_number, p.mpn)),
  p.id,
  coalesce(p.sku, p.product_code),
  null,
  case when p.oem_part_number is not null then 0.90 else 0.70 end,
  'Generated from product OEM/MPN fields. Supersession chain requires verified source before publication.',
  'product_catalog'
from public.product p
where coalesce(p.oem_part_number, p.part_number, p.mpn) is not null
  and btrim(coalesce(p.oem_part_number, p.part_number, p.mpn)) <> ''
on conflict (normalized_oem_part_number, product_sku) do update set
  product_id = excluded.product_id,
  confidence_score = excluded.confidence_score,
  notes = excluded.notes,
  updated_at = now();

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'machine','machine_type','track_spec','tread_pattern','attachment_fitment','oem_cross_reference',
    'product','fitment','inventory','catalog_embeddings'
  ] loop
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

create or replace function public.get_fitment_search_payload(search_q text, result_limit integer default 24)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
with normalized as (
  select public.normalize_heavy_iron_query(search_q) as q
),
matched_machines as (
  select
    ma.id,
    ma.make,
    ma.model,
    ma.model_key,
    ma.machine_type_code,
    ma.search_text
  from public.machine ma, normalized n
  where n.q <> ''
    and (
      public.normalize_heavy_iron_query(concat_ws(' ', ma.make, ma.model, ma.model_key, ma.search_text)) like '%' || n.q || '%'
      or public.normalize_heavy_iron_query(coalesce(ma.model_key, '')) = n.q
      or public.normalize_heavy_iron_query(concat_ws(' ', ma.make, ma.model)) like '%' || n.q || '%'
    )
  order by
    case
      when public.normalize_heavy_iron_query(coalesce(ma.model_key, '')) = n.q then 0
      when public.normalize_heavy_iron_query(concat_ws(' ', ma.make, ma.model)) = n.q then 1
      else 2
    end,
    ma.make,
    ma.model
  limit greatest(1, least(coalesce(result_limit, 24), 50))
),
joined as (
  select
    mm.id as machine_id,
    mm.make,
    mm.model,
    mm.model_key,
    mm.machine_type_code,
    p.id as product_id,
    coalesce(p.sku, p.product_code) as sku,
    p.title,
    p.handle,
    p.part_type,
    p.type as product_type,
    p.track_size,
    coalesce(ts.width_mm, p.width_mm) as width_mm,
    coalesce(ts.pitch_mm, p.pitch_mm) as pitch_mm,
    coalesce(ts.link_count, p.links) as link_count,
    coalesce(tp.label, p.tread_pattern) as tread_pattern,
    tp.vocation_mapping,
    tp.terrain_mapping,
    coalesce(p.base_price, p.price) as price,
    p.availability,
    min(inv.available_min) as inventory_min
  from matched_machines mm
  join public.fitment f on f.machine_id = mm.id
  join public.product p on p.id = f.product_id
  left join public.track_spec ts on ts.product_id = p.id
  left join public.tread_pattern tp on tp.code = ts.tread_pattern_code
  left join public.inventory inv on inv.product_id = p.id
  group by
    mm.id, mm.make, mm.model, mm.model_key, mm.machine_type_code,
    p.id, p.sku, p.product_code, p.title, p.handle, p.part_type, p.type,
    p.track_size, ts.width_mm, p.width_mm, ts.pitch_mm, p.pitch_mm,
    ts.link_count, p.links, tp.label, p.tread_pattern, tp.vocation_mapping,
    tp.terrain_mapping, p.base_price, p.price, p.availability
),
machine_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'make', make,
      'model', model,
      'model_key', model_key,
      'machine_type', machine_type_code,
      'href', '/pages/machines/' || coalesce(model_key, lower(regexp_replace(concat_ws('-', make, model), '[^a-zA-Z0-9]+', '-', 'g')))
    )
    order by make, model
  ), '[]'::jsonb) as machines
  from matched_machines
),
track_groups as (
  select coalesce(jsonb_agg(group_payload order by group_title), '[]'::jsonb) as groups
  from (
    select
      concat_ws(' ', make, model, track_size, 'Rubber Tracks') as group_title,
      jsonb_build_object(
        'type', 'tracks',
        'machine', jsonb_build_object('make', make, 'model', model, 'model_key', model_key, 'machine_type', machine_type_code),
        'title', concat_ws(' ', make, model, track_size, 'Rubber Tracks'),
        'track_size', track_size,
        'width_mm', max(width_mm),
        'pitch_mm', max(pitch_mm),
        'link_count', max(link_count),
        'variants', jsonb_agg(
          jsonb_build_object(
            'label', coalesce(tread_pattern, title),
            'sku', sku,
            'price', price,
            'handle', handle,
            'href', case when handle is not null then '/products/' || handle else null end,
            'availability', availability,
            'inventory_min', inventory_min,
            'vocation', coalesce(vocation_mapping, '{}'),
            'terrain', coalesce(terrain_mapping, '{}')
          )
          order by price nulls last, sku
        )
      ) as group_payload
    from joined
    where track_size is not null
    group by machine_id, make, model, model_key, machine_type_code, track_size
  ) grouped
),
part_groups as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'type', 'part',
      'machine', jsonb_build_object('make', make, 'model', model, 'model_key', model_key, 'machine_type', machine_type_code),
      'title', title,
      'sku', sku,
      'price', price,
      'handle', handle,
      'href', case when handle is not null then '/products/' || handle else null end,
      'availability', availability,
      'inventory_min', inventory_min,
      'part_type', coalesce(part_type, product_type)
    )
    order by make, model, title
  ), '[]'::jsonb) as groups
  from joined
  where track_size is null
)
select jsonb_build_object(
  'query', search_q,
  'machines', machine_json.machines,
  'groups', track_groups.groups || part_groups.groups,
  'callout', case
    when jsonb_array_length(machine_json.machines) = 0 then 'No verified fitments found yet.'
    else 'Verified Heavy Iron fitment data from Supabase.'
  end
)
from machine_json, track_groups, part_groups;
$$;

grant execute on function public.normalize_heavy_iron_query(text) to anon, authenticated;
grant execute on function public.get_fitment_search_payload(text, integer) to anon, authenticated;
