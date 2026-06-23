-- Media asset layer for My Fleet (DEV: zhdqdxtwipcowbtdyviq)
-- Normalized images with FK junctions to track sizes, products, models.
-- Unknown mappings → core.media_review_queue

CREATE TABLE IF NOT EXISTS core.media_asset (
  media_id text PRIMARY KEY,
  url text NOT NULL,
  storage_bucket text,
  storage_path text,
  alt_text text,
  mime_type text DEFAULT 'image/webp',
  role text NOT NULL DEFAULT 'gallery',
  source_system text,
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.track_size_media (
  track_size_id text NOT NULL REFERENCES core.track_size(track_size_id) ON DELETE CASCADE,
  media_id text NOT NULL REFERENCES core.media_asset(media_id) ON DELETE CASCADE,
  tread_pattern text,
  display_priority int NOT NULL DEFAULT 1,
  PRIMARY KEY (track_size_id, media_id)
);

CREATE TABLE IF NOT EXISTS core.product_media (
  product_id text NOT NULL REFERENCES core.product(product_id) ON DELETE CASCADE,
  media_id text NOT NULL REFERENCES core.media_asset(media_id) ON DELETE CASCADE,
  display_priority int NOT NULL DEFAULT 1,
  PRIMARY KEY (product_id, media_id)
);

CREATE TABLE IF NOT EXISTS core.model_media (
  machine_id text NOT NULL REFERENCES core.model(machine_id) ON DELETE CASCADE,
  media_id text NOT NULL REFERENCES core.media_asset(media_id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'hero',
  display_priority int NOT NULL DEFAULT 1,
  PRIMARY KEY (machine_id, media_id)
);

CREATE TABLE IF NOT EXISTS core.media_review_queue (
  review_id bigserial PRIMARY KEY,
  source_url text NOT NULL,
  detected_entity_type text,
  detected_ref text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  media_id text REFERENCES core.media_asset(media_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_track_size_media_ts ON core.track_size_media(track_size_id);
CREATE INDEX IF NOT EXISTS idx_track_size_media_tread ON core.track_size_media(track_size_id, tread_pattern);
CREATE INDEX IF NOT EXISTS idx_product_media_product ON core.product_media(product_id);
CREATE INDEX IF NOT EXISTS idx_model_media_machine ON core.model_media(machine_id);
CREATE INDEX IF NOT EXISTS idx_media_review_status ON core.media_review_queue(status);

GRANT SELECT ON core.media_asset TO anon, authenticated;
GRANT SELECT ON core.track_size_media TO anon, authenticated;
GRANT SELECT ON core.product_media TO anon, authenticated;
GRANT SELECT ON core.model_media TO anon, authenticated;
GRANT SELECT ON core.media_review_queue TO anon, authenticated;
