-- Track size v2 spine + filtered fleet reads (DEV: zhdqdxtwipcowbtdyviq)
-- My Fleet reads only cleaned core.track_size rows (128 spec-backed sizes).
-- Excludes legacy RUBBERTRACK pollution and 4+ chunk canonical strings.

CREATE OR REPLACE VIEW core.v_track_size_v2 AS
SELECT ts.*
FROM core.track_size ts
WHERE ts.canonical_size !~* 'rubbertrack'
  AND cardinality(string_to_array(lower(ts.canonical_size), 'x')) <= 3;

CREATE OR REPLACE VIEW core.v_track_size_spine_v2 AS
SELECT
  ts.track_size_id,
  ts.canonical_size,
  COUNT(DISTINCT p.product_id) AS product_count,
  COUNT(DISTINCT f.machine_id) AS machine_count,
  COUNT(DISTINCT f.fitment_id) AS fitment_count
FROM core.v_track_size_v2 ts
LEFT JOIN core.product p ON p.track_size_id = ts.track_size_id
LEFT JOIN core.fitment f ON f.product_id = p.product_id
GROUP BY ts.track_size_id, ts.canonical_size;

CREATE OR REPLACE VIEW public.fleet_track_size_spine AS
SELECT * FROM core.v_track_size_spine_v2;

CREATE OR REPLACE VIEW public.fleet_products AS
SELECT
  p.product_id,
  p.sku,
  p.supplier_sku,
  p.shopify_sku,
  p.title,
  p.product_type,
  p.track_size_id,
  ts.canonical_size AS track_size,
  p.pattern,
  p.cost,
  p.price,
  p.qty_available,
  p.weight_lbs,
  p.product_url,
  p.source_systems
FROM core.product p
INNER JOIN core.v_track_size_v2 ts ON ts.track_size_id = p.track_size_id;

CREATE OR REPLACE VIEW public.fleet_qa_parts AS
SELECT
  f.fitment_id,
  mo.machine_id,
  ma.brand,
  mo.model,
  mo.model_canonical,
  mo.machine_type,
  mts.canonical_size AS machine_track_size,
  mo.primary_track_size_id AS machine_track_size_id,
  p.product_id,
  p.sku,
  p.supplier_sku,
  p.title,
  p.product_type,
  p.pattern,
  p.track_size_id AS product_track_size_id,
  pts.canonical_size AS product_track_size,
  p.price,
  p.qty_available,
  p.cost,
  p.product_url,
  p.source_systems,
  f.fitment_type,
  f.confidence,
  f.source AS fitment_source
FROM core.fitment f
JOIN core.model mo ON mo.machine_id = f.machine_id
JOIN core.make ma ON ma.brand_id = mo.brand_id
JOIN core.product p ON p.product_id = f.product_id
LEFT JOIN core.v_track_size_v2 mts ON mts.track_size_id = mo.primary_track_size_id
LEFT JOIN core.v_track_size_v2 pts ON pts.track_size_id = p.track_size_id
WHERE
  NOT (
    (p.product_type ILIKE '%track%' OR p.product_type = 'Track Pads')
    AND pts.track_size_id IS NULL
  );

GRANT SELECT ON core.v_track_size_v2 TO anon, authenticated;
GRANT SELECT ON core.v_track_size_spine_v2 TO anon, authenticated;
