create or replace function public.get_machine_bento(slug text)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
with normalized_input as (
  select lower(
    split_part(
      regexp_replace(
        regexp_replace(btrim(coalesce(slug, '')), '^https?://[^/]+/pages/model/', '', 'i'),
        '^/?pages/model/',
        '',
        'i'
      ),
      '?',
      1
    )
  ) as model_key
),
target_machine as (
  select
    m.id,
    m.make,
    m.model,
    m.model_key,
    m.machine_type_code,
    m.year_start,
    m.year_end,
    m.serial_range,
    m.operating_weight_lb,
    m.hydraulic_flow_gpm,
    m.high_flow_gpm,
    case
      when m.hero_image_cdn like 'https://cdn.shopify.com/%' then m.hero_image_cdn
      else null
    end as hero_image_cdn,
    m.hero_image_alt,
    case
      when m.undercarriage_diagram_cdn like 'https://cdn.shopify.com/%' then m.undercarriage_diagram_cdn
      else null
    end as undercarriage_diagram_cdn
  from public.machine m
  join normalized_input i on m.model_key = i.model_key
  limit 1
),
fitment_products as (
  select
    f.fit_type,
    f.is_primary,
    f.position,
    f.qty_per_machine,
    f.serial_range,
    f.notes,
    p.id as product_id,
    coalesce(p.sku, p.product_code) as sku,
    p.mpn,
    p.gtin,
    p.shopify_product_id,
    p.shopify_variant_id,
    p.shopify_media_id,
    p.shopify_variant_media_id,
    p.title,
    p.handle,
    p.type,
    p.part_type,
    p.attachment_category,
    p.track_size,
    p.width_mm,
    p.pitch_mm,
    p.links,
    p.guide_type,
    p.tread_pattern,
    coalesce(p.base_price, p.price) as price,
    p.compare_at_price,
    p.weight_lbs,
    p.availability,
    p.status,
    case
      when p.image_url like 'https://cdn.shopify.com/%' then p.image_url
      else null
    end as image_url,
    p.image_alt
  from target_machine m
  join public.fitment f on f.machine_id = m.id
  join public.product p on p.id = f.product_id
),
attachment_products as (
  select
    'attachment'::text as fit_type,
    true as is_primary,
    null::text as position,
    null::numeric as qty_per_machine,
    null::text as serial_range,
    af.notes,
    p.id as product_id,
    coalesce(p.sku, p.product_code, af.product_sku) as sku,
    p.mpn,
    p.gtin,
    p.shopify_product_id,
    p.shopify_variant_id,
    p.shopify_media_id,
    p.shopify_variant_media_id,
    p.title,
    p.handle,
    p.type,
    p.part_type,
    coalesce(p.attachment_category, af.attachment_category) as attachment_category,
    p.track_size,
    p.width_mm,
    p.pitch_mm,
    p.links,
    p.guide_type,
    p.tread_pattern,
    coalesce(p.base_price, p.price) as price,
    p.compare_at_price,
    p.weight_lbs,
    p.availability,
    p.status,
    case
      when p.image_url like 'https://cdn.shopify.com/%' then p.image_url
      else null
    end as image_url,
    p.image_alt
  from target_machine m
  join public.attachment_fitment af on af.machine_id = m.id
  join public.product p on p.id = af.product_id
),
all_products as (
  select * from fitment_products
  union all
  select * from attachment_products
),
classified_products as (
  select
    ap.*,
    case
      when ap.fit_type = 'track' or ap.track_size is not null then 'tracks'
      when ap.fit_type in ('uc_part', 'undercarriage')
        or lower(concat_ws(' ', ap.type, ap.part_type, ap.title)) similar to '%(idler|roller|sprocket|undercarriage)%'
        then 'undercarriage'
      when ap.fit_type = 'attachment' or ap.attachment_category is not null then 'attachments'
      else 'other'
    end as bento_bucket
  from all_products ap
),
product_cards as (
  select
    cp.bento_bucket,
    jsonb_build_object(
      'sku', cp.sku,
      'mpn', cp.mpn,
      'gtin', cp.gtin,
      'title', cp.title,
      'handle', cp.handle,
      'url', case when cp.handle is not null then '/products/' || cp.handle else null end,
      'shopify_product_id', cp.shopify_product_id,
      'shopify_variant_id', cp.shopify_variant_id,
      'shopify_media_id', cp.shopify_media_id,
      'shopify_variant_media_id', cp.shopify_variant_media_id,
      'price', cp.price,
      'compare_at_price', cp.compare_at_price,
      'availability', coalesce(cp.availability, cp.status),
      'image', cp.image_url,
      'image_alt', coalesce(cp.image_alt, cp.title),
      'fit_type', cp.fit_type,
      'is_primary', coalesce(cp.is_primary, false),
      'position', cp.position,
      'qty_per_machine', cp.qty_per_machine,
      'serial_range', cp.serial_range,
      'notes', cp.notes,
      'type', cp.type,
      'part_type', cp.part_type,
      'attachment_category', cp.attachment_category,
      'track_size', cp.track_size,
      'width_mm', cp.width_mm,
      'pitch_mm', cp.pitch_mm,
      'links', cp.links,
      'guide_type', cp.guide_type,
      'tread_pattern', cp.tread_pattern,
      'weight_lbs', cp.weight_lbs
    ) as card,
    cp.track_size,
    cp.tread_pattern,
    cp.part_type,
    cp.title,
    cp.price,
    cp.sku
  from classified_products cp
  where cp.bento_bucket in ('tracks', 'undercarriage', 'attachments')
)
select jsonb_build_object(
  'machine',
  coalesce(
    (
      select jsonb_build_object(
        'id', tm.id,
        'make', tm.make,
        'model', tm.model,
        'model_key', tm.model_key,
        'url', '/pages/model/' || tm.model_key,
        'machine_type_code', tm.machine_type_code,
        'year_start', tm.year_start,
        'year_end', tm.year_end,
        'serial_range', tm.serial_range,
        'operating_weight_lb', tm.operating_weight_lb,
        'hydraulic_flow_gpm', tm.hydraulic_flow_gpm,
        'high_flow_gpm', tm.high_flow_gpm,
        'hero_image_cdn', tm.hero_image_cdn,
        'hero_image_alt', tm.hero_image_alt,
        'undercarriage_diagram_cdn', tm.undercarriage_diagram_cdn
      )
      from target_machine tm
    ),
    '{}'::jsonb
  ),
  'tracks',
  coalesce(
    (
      select jsonb_agg(pc.card order by pc.track_size nulls last, pc.tread_pattern nulls last, pc.price nulls last, pc.sku nulls last)
      from product_cards pc
      where pc.bento_bucket = 'tracks'
    ),
    '[]'::jsonb
  ),
  'undercarriage',
  coalesce(
    (
      select jsonb_agg(pc.card order by pc.part_type nulls last, pc.title nulls last, pc.sku nulls last)
      from product_cards pc
      where pc.bento_bucket = 'undercarriage'
    ),
    '[]'::jsonb
  ),
  'attachments',
  coalesce(
    (
      select jsonb_agg(pc.card order by pc.part_type nulls last, pc.title nulls last, pc.sku nulls last)
      from product_cards pc
      where pc.bento_bucket = 'attachments'
    ),
    '[]'::jsonb
  )
);
$$;

grant execute on function public.get_machine_bento(text) to anon, authenticated;
