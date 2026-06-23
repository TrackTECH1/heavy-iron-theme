-- Heavy Iron / TrackTECH catalog quality views.
-- Reviewable, read-only dashboard surfaces. These do not mutate catalog data.

create or replace view public.v_admin_inventory_by_product_warehouse
with (security_invoker = true)
as
select
  i.product_id,
  i.warehouse_id,
  max(i.itemid) as itemid,
  array_agg(distinct i.sku order by i.sku) filter (where i.sku is not null and btrim(i.sku) <> '') as skus,
  max(i.available_band) as available_band,
  max(i.available_min) as available_min,
  count(*) as source_rows
from public.inventory i
where i.product_id is not null
group by i.product_id, i.warehouse_id;

create or replace view public.v_admin_machine_summary
with (security_invoker = true)
as
select
  m.id,
  m.model_key,
  m.make,
  m.model,
  m.machine_type_code,
  m.track_sizes_cache,
  m.verified,
  m.shopify_metaobject_gid,
  count(f.id) as fitment_count,
  count(distinct f.product_id) as compatible_product_count,
  m.updated_at
from public.model m
left join public.fitment f on f.model_id = m.id
group by
  m.id,
  m.model_key,
  m.make,
  m.model,
  m.machine_type_code,
  m.track_sizes_cache,
  m.verified,
  m.shopify_metaobject_gid,
  m.updated_at;

create or replace view public.v_admin_product_summary
with (security_invoker = true)
as
select
  p.id,
  p.product_code,
  p.sku,
  p.itemid,
  p.title,
  p.type,
  p.part_type,
  p.track_size,
  p.tread_pattern,
  p.price,
  p.cost,
  p.status,
  p.shopify_product_id,
  p.shopify_variant_id,
  count(f.id) as fitment_count,
  p.updated_at
from public.product p
left join public.fitment f on f.product_id = p.id
group by
  p.id,
  p.product_code,
  p.sku,
  p.itemid,
  p.title,
  p.type,
  p.part_type,
  p.track_size,
  p.tread_pattern,
  p.price,
  p.cost,
  p.status,
  p.shopify_product_id,
  p.shopify_variant_id,
  p.updated_at;

create or replace view public.v_data_quality_catalog_metrics
with (security_invoker = true)
as
select 'product_missing_sku' as metric, count(*)::bigint as value from public.product where sku is null or btrim(sku) = ''
union all select 'product_missing_itemid', count(*) from public.product where itemid is null or btrim(itemid) = ''
union all select 'product_missing_part_type', count(*) from public.product where part_type is null or btrim(part_type) = ''
union all select 'track_like_product_missing_track_size', count(*) from public.product where (coalesce(type, '') ilike '%track%' or coalesce(part_type, '') ilike '%track%') and (track_size is null or btrim(track_size) = '')
union all select 'product_missing_shopify_product_id', count(*) from public.product where shopify_product_id is null or btrim(shopify_product_id) = ''
union all select 'product_missing_shopify_variant_id', count(*) from public.product where shopify_variant_id is null or btrim(shopify_variant_id) = ''
union all select 'product_duplicate_non_null_sku_groups', count(*) from (
  select sku from public.product where sku is not null and btrim(sku) <> '' group by sku having count(*) > 1
) d
union all select 'model_missing_machine_type_code', count(*) from public.model where machine_type_code is null or btrim(machine_type_code) = ''
union all select 'model_missing_shopify_metaobject_gid', count(*) from public.model where shopify_metaobject_gid is null or btrim(shopify_metaobject_gid) = ''
union all select 'fitment_missing_model_id', count(*) from public.fitment where model_id is null
union all select 'fitment_missing_product_id', count(*) from public.fitment where product_id is null
union all select 'fitment_duplicate_model_product_groups', count(*) from (
  select model_id, product_id from public.fitment where model_id is not null and product_id is not null group by model_id, product_id having count(*) > 1
) d
union all select 'inventory_duplicate_product_warehouse_groups', count(*) from (
  select product_id, warehouse_id from public.inventory where product_id is not null group by product_id, warehouse_id having count(*) > 1
) d
union all select 'inventory_product_id_orphans', count(*) from public.inventory i left join public.product p on p.id = i.product_id where i.product_id is not null and p.id is null
union all select 'catalog_image_itemid_orphans', count(*) from public.catalog_images ci left join public.product p on p.itemid = ci.itemid where ci.itemid is not null and p.id is null
union all select 'store_variant_map_itemid_orphans', count(*) from public.store_variant_map svm left join public.product p on p.itemid = svm.itemid where svm.itemid is not null and p.id is null
union all select 'store_pricing_sku_orphans', count(*) from public.tracktech_store_pricing sp left join public.product p on p.sku = sp.sku where sp.sku is not null and p.id is null;

create or replace view public.v_data_quality_duplicate_skus
with (security_invoker = true)
as
select
  p.sku,
  count(*) as product_count,
  array_agg(p.id order by p.updated_at desc nulls last, p.id) as product_ids,
  array_agg(p.product_code order by p.updated_at desc nulls last, p.id) as product_codes,
  array_agg(p.title order by p.updated_at desc nulls last, p.id) as titles,
  max(p.updated_at) as newest_updated_at
from public.product p
where p.sku is not null and btrim(p.sku) <> ''
group by p.sku
having count(*) > 1;

create or replace view public.v_data_quality_product_publish_queue
with (security_invoker = true)
as
select
  p.id,
  p.product_code,
  p.sku,
  p.itemid,
  p.title,
  p.type,
  p.part_type,
  p.track_size,
  p.shopify_product_id,
  p.shopify_variant_id,
  case
    when p.sku is null or btrim(p.sku) = '' then 'missing_sku'
    when p.part_type is null or btrim(p.part_type) = '' then 'missing_part_type'
    when (coalesce(p.type, '') ilike '%track%' or coalesce(p.part_type, '') ilike '%track%') and (p.track_size is null or btrim(p.track_size) = '') then 'missing_track_size'
    when p.shopify_product_id is null or btrim(p.shopify_product_id) = '' then 'not_linked_to_shopify_product'
    when p.shopify_variant_id is null or btrim(p.shopify_variant_id) = '' then 'not_linked_to_shopify_variant'
    else 'ready'
  end as readiness_status,
  p.updated_at
from public.product p;

create or replace view public.v_data_quality_orphan_references
with (security_invoker = true)
as
select
  'inventory.product_id' as source,
  i.product_id::text as source_key,
  count(*) as row_count
from public.inventory i
left join public.product p on p.id = i.product_id
where i.product_id is not null and p.id is null
group by i.product_id
union all
select
  'catalog_images.itemid' as source,
  ci.itemid as source_key,
  count(*) as row_count
from public.catalog_images ci
left join public.product p on p.itemid = ci.itemid
where ci.itemid is not null and p.id is null
group by ci.itemid
union all
select
  'store_variant_map.itemid' as source,
  svm.itemid as source_key,
  count(*) as row_count
from public.store_variant_map svm
left join public.product p on p.itemid = svm.itemid
where svm.itemid is not null and p.id is null
group by svm.itemid
union all
select
  'tracktech_store_pricing.sku' as source,
  sp.sku as source_key,
  count(*) as row_count
from public.tracktech_store_pricing sp
left join public.product p on p.sku = sp.sku
where sp.sku is not null and p.id is null
group by sp.sku;

grant select on public.v_admin_inventory_by_product_warehouse to authenticated;
grant select on public.v_admin_machine_summary to authenticated;
grant select on public.v_admin_product_summary to authenticated;
grant select on public.v_data_quality_catalog_metrics to authenticated;
grant select on public.v_data_quality_duplicate_skus to authenticated;
grant select on public.v_data_quality_product_publish_queue to authenticated;
grant select on public.v_data_quality_orphan_references to authenticated;
