-- Nightly Shopify fitment sync (pg_cron + pg_net).
-- Job: tt-sync-product-fitments @ 07:20 UTC daily (after tt-embed-drain).
-- Calls sync-product-fitments edge function: dry_run=false, limit=50, offset alternates 0/50 by day-of-year (~91 eligible products, full refresh every 2 nights).
-- Idempotent: re-upserts fitment metaobjects + custom.fitments metafields; safe to rerun.

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'tt-sync-product-fitments';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'tt-sync-product-fitments',
  '20 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://tcykyktvdlsbscrsbjyt.supabase.co/functions/v1/sync-product-fitments',
    body := jsonb_build_object(
      'dry_run', false,
      'limit', 50,
      'offset', (extract(doy from now())::int % 2) * 50
    ),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  $$
);
