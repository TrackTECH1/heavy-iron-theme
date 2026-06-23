-- My Fleet Content Studio + Meta social publishing (dev)

CREATE TABLE IF NOT EXISTS public.content_campaign (
  campaign_id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_draft (
  draft_id text PRIMARY KEY,
  campaign_id text REFERENCES public.content_campaign (campaign_id) ON DELETE SET NULL,
  entity_type text NOT NULL
    CHECK (entity_type IN ('machine', 'track_size', 'product')),
  entity_id text NOT NULL,
  entity_label text,
  headline text,
  body text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  shopify_url text,
  image_url text,
  media_id text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'published', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by text,
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_content_draft_status ON public.content_draft (status);
CREATE INDEX IF NOT EXISTS idx_content_draft_entity ON public.content_draft (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.content_asset (
  asset_id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES public.content_draft (draft_id) ON DELETE CASCADE,
  media_id text,
  url text NOT NULL,
  role text NOT NULL DEFAULT 'primary'
    CHECK (role IN ('primary', 'gallery', 'alt')),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_asset_draft ON public.content_asset (draft_id);

CREATE TABLE IF NOT EXISTS public.social_account (
  account_id text PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram', 'meta')),
  page_id text,
  page_name text,
  instagram_business_account_id text,
  token_vault_ref text NOT NULL DEFAULT 'env:META_ACCESS_TOKEN',
  access_token text,
  token_expires_at timestamptz,
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'expired', 'disconnected')),
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_publish_job (
  job_id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES public.content_draft (draft_id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram', 'both')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'partial')),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_publish_job_draft ON public.social_publish_job (draft_id);

CREATE TABLE IF NOT EXISTS public.social_publish_log (
  log_id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES public.social_publish_job (job_id) ON DELETE CASCADE,
  draft_id text NOT NULL REFERENCES public.content_draft (draft_id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  external_post_id text,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  request_payload jsonb,
  response_payload jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_publish_log_job ON public.social_publish_log (job_id);

-- RLS: block anon/authenticated from reading tokens; service role bypasses RLS
ALTER TABLE public.content_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY content_draft_read ON public.content_draft
  FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY content_draft_write ON public.content_draft
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY content_campaign_all ON public.content_campaign
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY content_asset_all ON public.content_asset
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY social_account_service ON public.social_account
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY social_publish_job_service ON public.social_publish_job
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY social_publish_log_service ON public.social_publish_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Safe public read of connection metadata (no token column exposure via view)
CREATE OR REPLACE VIEW public.fleet_social_connection AS
SELECT
  account_id,
  platform,
  page_id,
  page_name,
  instagram_business_account_id,
  token_vault_ref,
  token_expires_at,
  status,
  connected_at,
  updated_at,
  (access_token IS NOT NULL OR token_vault_ref = 'env:META_ACCESS_TOKEN') AS has_token
FROM public.social_account
WHERE platform = 'meta';

GRANT SELECT ON public.fleet_social_connection TO anon, authenticated;
