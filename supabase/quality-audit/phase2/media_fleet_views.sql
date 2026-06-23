-- Fleet read views for media + enrichment tasks (DEV)

CREATE OR REPLACE VIEW public.fleet_model_hero AS
SELECT
  mo.machine_id,
  mo.brand_id,
  ma.brand,
  mo.model,
  m.role,
  a.media_id,
  a.url,
  a.alt_text,
  a.storage_bucket,
  a.storage_path
FROM core.model mo
JOIN core.make ma ON ma.brand_id = mo.brand_id
LEFT JOIN core.model_media m ON m.machine_id = mo.machine_id AND m.role = 'hero'
LEFT JOIN core.media_asset a ON a.media_id = m.media_id;

CREATE OR REPLACE VIEW public.fleet_track_size_media AS
SELECT
  ts.track_size_id,
  ts.canonical_size,
  tsm.tread_pattern,
  tsm.display_priority,
  a.media_id,
  a.url,
  a.alt_text,
  a.role,
  a.storage_bucket,
  a.storage_path
FROM core.v_track_size_v2 ts
JOIN core.track_size_media tsm ON tsm.track_size_id = ts.track_size_id
JOIN core.media_asset a ON a.media_id = tsm.media_id;

CREATE OR REPLACE VIEW public.fleet_product_media AS
SELECT
  p.product_id,
  p.sku,
  p.track_size_id,
  pm.display_priority,
  a.media_id,
  a.url,
  a.alt_text,
  a.role,
  a.storage_bucket,
  a.storage_path
FROM core.product p
JOIN core.product_media pm ON pm.product_id = p.product_id
JOIN core.media_asset a ON a.media_id = pm.media_id;

-- Read-only enrichment suggestions (no auto-publish)
CREATE OR REPLACE VIEW public.fleet_enrichment_tasks AS
SELECT
  'missing_machine_hero'::text AS task_type,
  mo.machine_id AS entity_id,
  ma.brand || ' ' || mo.model AS entity_label,
  'No hero image in model_media'::text AS detail,
  'import_hero_manifest'::text AS suggested_action
FROM core.model mo
JOIN core.make ma ON ma.brand_id = mo.brand_id
WHERE mo.machine_status = 'active_v1'
  AND NOT EXISTS (
    SELECT 1 FROM core.model_media mm
    WHERE mm.machine_id = mo.machine_id AND mm.role = 'hero'
  )

UNION ALL

SELECT
  'missing_track_size_image',
  mats.track_size_id,
  mats.canonical_size,
  'Approved machine size has no track_size_media',
  'import_hi_master_csv'
FROM (
  SELECT DISTINCT mats.track_size_id, mats.canonical_size
  FROM core.machine_approved_track_size mats
  JOIN core.model mo ON mo.machine_id = mats.machine_id
  WHERE mo.machine_status = 'active_v1'
) mats
WHERE NOT EXISTS (
  SELECT 1 FROM core.track_size_media tsm WHERE tsm.track_size_id = mats.track_size_id
)

UNION ALL

SELECT
  'product_missing_track_size',
  p.product_id,
  p.sku,
  'Track product without v2 track_size_id',
  'repoint_from_tracktech_specs'
FROM core.product p
WHERE (p.product_type ILIKE '%track%' OR p.product_type = 'Track Pads')
  AND p.sku ILIKE 'TNT%'
  AND p.track_size_id IS NULL

UNION ALL

SELECT
  'machine_missing_tnt_tracks',
  mo.machine_id,
  ma.brand || ' ' || mo.model,
  'active_v1 machine has no TNT track fitments',
  'review_fitment_import'
FROM core.model mo
JOIN core.make ma ON ma.brand_id = mo.brand_id
WHERE mo.machine_status = 'active_v1'
  AND NOT EXISTS (
    SELECT 1
    FROM core.fitment f
    JOIN core.product p ON p.product_id = f.product_id
    WHERE f.machine_id = mo.machine_id
      AND p.sku ILIKE 'TNT%'
      AND p.product_type ILIKE '%track%'
      AND p.track_size_id IS NOT NULL
  )

UNION ALL

SELECT
  'missing_machine_spec',
  mo.machine_id,
  ma.brand || ' ' || mo.model,
  'Missing horsepower or operating weight',
  'import_machine_specs'
FROM core.model mo
JOIN core.make ma ON ma.brand_id = mo.brand_id
WHERE mo.machine_status = 'active_v1'
  AND (mo.horsepower IS NULL OR mo.operating_weight_lbs IS NULL);

GRANT SELECT ON public.fleet_model_hero TO anon, authenticated;
GRANT SELECT ON public.fleet_track_size_media TO anon, authenticated;
GRANT SELECT ON public.fleet_product_media TO anon, authenticated;
GRANT SELECT ON public.fleet_enrichment_tasks TO anon, authenticated;
