-- Heavy Iron semantic search contract + security hardening.
--
-- Apply from Supabase SQL editor or CLI after confirming pgvector is enabled.
-- This migration is intentionally non-destructive: it adds RPCs, pins function
-- search_path, and removes public/anon access from admin-only views.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

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

create or replace function public.match_catalog_items(
  query_text text default null,
  query_embedding extensions.vector default null,
  match_count int default 20,
  source_filter text default null
)
returns table (
  source_type text,
  source_id text,
  title text,
  subtitle text,
  handle text,
  sku text,
  part_type text,
  track_size text,
  machine_make text,
  machine_model text,
  score double precision,
  metadata jsonb
)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with normalized as (
    select
      public.normalize_heavy_iron_query(query_text) as q,
      coalesce(match_count, 20) as lim
  ),
  candidates as (
    select
      ce.source_type,
      ce.source_id::text,
      coalesce(p.title, concat_ws(' ', m.make, m.model), ce.content) as title,
      case
        when ce.source_type = 'product' then concat_ws(' | ', p.part_type, p.track_size, p.tread_pattern)
        when ce.source_type = 'model' then concat_ws(' | ', m.machine_type_code, m.track_sizes_cache::text)
        else ce.source_type
      end as subtitle,
      coalesce(p.handle, m.model_handle, m.model_key) as handle,
      p.sku,
      p.part_type,
      p.track_size,
      m.make as machine_make,
      m.model as machine_model,
      ce.metadata,
      case
        when query_embedding is null or ce.embedding is null then 0::double precision
        else greatest(0::double precision, 1 - (ce.embedding <=> query_embedding))
      end as vector_score,
      case
        when normalized.q = '' then 0::double precision
        else greatest(
          similarity(public.normalize_heavy_iron_query(coalesce(ce.content, '')), normalized.q),
          similarity(public.normalize_heavy_iron_query(coalesce(p.title, '')), normalized.q),
          similarity(public.normalize_heavy_iron_query(coalesce(p.sku, '')), normalized.q),
          similarity(public.normalize_heavy_iron_query(coalesce(p.track_size, '')), normalized.q),
          similarity(public.normalize_heavy_iron_query(concat_ws(' ', m.make, m.model, m.model_key, m.search_aliases::text)), normalized.q)
        )
      end as lexical_score,
      case
        when normalized.q <> ''
          and (
            public.normalize_heavy_iron_query(coalesce(p.sku, '')) = normalized.q
            or public.normalize_heavy_iron_query(coalesce(p.track_size, '')) = normalized.q
            or public.normalize_heavy_iron_query(coalesce(m.model_key, '')) = normalized.q
          )
        then 0.25::double precision
        else 0::double precision
      end as exact_bonus
    from public.catalog_embeddings ce
    cross join normalized
    left join public.product p
      on ce.source_type = 'product'
     and ce.source_id = p.id
    left join public.model m
      on ce.source_type = 'model'
     and ce.source_id = m.id
    where (source_filter is null or ce.source_type = source_filter)
  )
  select
    candidates.source_type,
    candidates.source_id,
    candidates.title,
    candidates.subtitle,
    candidates.handle,
    candidates.sku,
    candidates.part_type,
    candidates.track_size,
    candidates.machine_make,
    candidates.machine_model,
    (candidates.vector_score * 0.65 + candidates.lexical_score * 0.35 + candidates.exact_bonus) as score,
    candidates.metadata
  from candidates
  where
    candidates.vector_score > 0
    or candidates.lexical_score > 0.08
    or candidates.exact_bonus > 0
  order by score desc, title asc
  limit (select lim from normalized);
$$;

create or replace function public.match_machine_fitment_products(
  query_text text,
  query_embedding extensions.vector default null,
  match_count int default 24
)
returns table (
  model_id uuid,
  model_key text,
  make text,
  model text,
  product_id uuid,
  product_title text,
  product_handle text,
  sku text,
  part_type text,
  track_size text,
  tread_pattern text,
  fit_type text,
  score double precision
)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with model_hits as (
    select *
    from public.match_catalog_items(query_text, query_embedding, 10, 'model')
  )
  select
    m.id as model_id,
    m.model_key,
    m.make,
    m.model,
    p.id as product_id,
    p.title as product_title,
    p.handle as product_handle,
    p.sku,
    p.part_type,
    p.track_size,
    p.tread_pattern,
    f.fit_type,
    mh.score
  from model_hits mh
  join public.model m on m.id::text = mh.source_id
  join public.fitment f on f.model_id = m.id
  join public.product p on p.id = f.product_id
  where coalesce(p.status, '') <> 'archived'
  order by mh.score desc, f.is_primary desc nulls last, p.part_type asc, p.track_size asc, p.title asc
  limit coalesce(match_count, 24);
$$;

-- Public storefront search may call the RPCs; raw tables stay protected by RLS/grants.
grant execute on function public.normalize_heavy_iron_query(text) to anon, authenticated;
grant execute on function public.match_catalog_items(text, extensions.vector, int, text) to anon, authenticated;
grant execute on function public.match_machine_fitment_products(text, extensions.vector, int) to anon, authenticated;

-- Admin/data-quality views should not be reachable by anonymous clients.
revoke all on public.v_admin_inventory_by_product_warehouse from anon;
revoke all on public.v_admin_machine_summary from anon;
revoke all on public.v_admin_product_summary from anon;
revoke all on public.v_data_quality_catalog_metrics from anon;
revoke all on public.v_data_quality_duplicate_skus from anon;
revoke all on public.v_data_quality_product_publish_queue from anon;
revoke all on public.v_data_quality_orphan_references from anon;

-- Pin search_path for all non-extension public functions as a defense-in-depth
-- pass. Existing signatures are discovered dynamically.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', fn.signature);
  end loop;
end $$;
