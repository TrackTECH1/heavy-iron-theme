import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * sync-product-fitments — Publish Supabase fitment rows → Shopify product custom.fitments
 *
 * POST {
 *   dry_run?: boolean (default true),
 *   limit?: number (max 50),
 *   offset?: number,
 *   handle?: string,
 *   allow_partial?: boolean (default false — see "all-or-nothing" below)
 * }
 * Headers: x-sync-key (required for live writes, matches SYNC_API_KEY secret)
 *
 * Requires Supabase secrets: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, SYNC_API_KEY
 * Optional: SHOPIFY_API_VERSION (default 2025-10)
 *
 * Deploy: supabase functions deploy sync-product-fitments --no-verify-jwt
 * Run dry:  curl -X POST .../sync-product-fitments -d '{"dry_run":true,"limit":5}'
 * Run live: curl -X POST .../sync-product-fitments -H 'x-sync-key: ...' -d '{"dry_run":false,"limit":25}'
 * On-demand only (nightly cron removed). After Supabase fitment edits:
 *   ./scripts/consolidate-fitment.sh
 *
 * Safety model (see docs/architecture/fitment-data-pipeline.md):
 *  - Auth FAILS CLOSED for live writes: no SYNC_API_KEY configured => live sync refused.
 *  - Shopify throttling (HTTP 200 + top-level `errors` / THROTTLED) is detected and retried
 *    with exponential backoff instead of being silently treated as success.
 *  - ALL-OR-NOTHING per product: metafieldsSet REPLACES the whole custom.fitments list, so a
 *    partially-resolved product would drop fitments. When allow_partial=false (default) a
 *    product with any unresolved model is DEFERRED (left untouched on Shopify) and reported,
 *    rather than overwritten with an incomplete list.
 *  - Reads are ordered + paginated so the offset/limit window is deterministic and not capped
 *    by PostgREST's default db-max-rows.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FITMENT_MO_TYPE = "fitment";
const SHOPIFY_MAX_RETRIES = 5;
const SHOPIFY_BASE_DELAY_MS = 500;
const FITMENT_PAGE_SIZE = 1000;

type MakeRow = { handle: string; gid: string; name: string };

type FitRow = {
  shopify_product_id: string;
  product_handle: string;
  model_key: string;
  model_gid: string;
  make_raw: string;
};

type TrackMapRow = { handle: string; product_id: string };
type VariantMapRow = { handle: string; size_digits: string; tread: string };

const TREAD_TO_SHOPIFY: Record<string, string> = {
  Directional: "directional",
  "Multi-Bar": "multi-bar",
  MX: "mx",
  "C-Block": "c-block",
  "Zig-Zag": "zig-zag",
  "Z-Max": "z-max",
  ZB: "z-max",
  "Staggered Block": "staggered-block",
  "X-Terrain": "x-terrain",
  "All-Terrain": "all-terrain",
  Block: "offset-block",
  "L-Tread": "directional",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function sizeDigitsFromTrackSize(trackSize: string): string {
  return (trackSize || "").replace(/[^0-9]/g, "");
}

function resolveProductGid(
  product: {
    shopify_product_id?: string;
    handle?: string;
    track_size?: string;
    tread_pattern?: string;
  } | null,
  variantByKey: Map<string, string>,
  trackByHandle: Map<string, string>,
): { gid: string | null; handle: string } {
  if (!product) return { gid: null, handle: "" };
  if (product.shopify_product_id) {
    return { gid: product.shopify_product_id, handle: product.handle || "" };
  }
  const tread = TREAD_TO_SHOPIFY[product.tread_pattern || ""];
  const digits = sizeDigitsFromTrackSize(product.track_size || "");
  if (!tread || !digits) return { gid: null, handle: product.handle || "" };
  const shopifyHandle = variantByKey.get(`${digits}::${tread}`);
  if (!shopifyHandle) return { gid: null, handle: product.handle || "" };
  const gid = trackByHandle.get(shopifyHandle) ?? null;
  return { gid, handle: shopifyHandle };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

function isThrottled(data: unknown): boolean {
  const errors = (data as { errors?: unknown })?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((e) => {
    const code = (e as { extensions?: { code?: string } })?.extensions?.code;
    const msg = (e as { message?: string })?.message || "";
    return code === "THROTTLED" || /throttl/i.test(msg);
  });
}

/**
 * Shopify GraphQL Admin call with throttle/5xx-aware retry.
 * Shopify returns HTTP 200 with a top-level `errors` array on throttling, so a naive
 * `r.ok`-only check treats a throttled write as success and silently drops data.
 */
async function shopifyGql(
  shop: string,
  token: string,
  apiVersion: string,
  query: string,
  variables: Record<string, unknown> = {},
  attempt = 0,
): Promise<{ data?: Record<string, unknown>; errors?: unknown }> {
  const r = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  let data: { data?: Record<string, unknown>; errors?: unknown };
  try {
    data = await r.json();
  } catch {
    data = {};
  }

  const retryable = r.status === 429 || r.status >= 500 || isThrottled(data);
  if (retryable && attempt < SHOPIFY_MAX_RETRIES) {
    const wait = SHOPIFY_BASE_DELAY_MS * 2 ** attempt;
    await sleep(wait);
    return shopifyGql(shop, token, apiVersion, query, variables, attempt + 1);
  }

  if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${JSON.stringify(data)}`);
  if (Array.isArray(data?.errors) && data.errors.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
  }
  return data;
}

function resolveMakeGid(makeRaw: string, makes: MakeRow[]): string | null {
  const raw = (makeRaw || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  let hit = makes.find((m) => m.name.toLowerCase() === lower);
  if (hit) return hit.gid;
  hit = makes.find((m) =>
    m.name.toLowerCase().startsWith(lower) || lower.startsWith(m.name.toLowerCase())
  );
  if (hit) return hit.gid;
  hit = makes.find((m) => {
    const h = m.handle.replace(/-/g, " ");
    return h.includes(lower) || lower.includes(h);
  });
  return hit?.gid ?? null;
}

async function upsertFitmentMo(
  shop: string,
  token: string,
  apiVersion: string,
  handle: string,
  makeGid: string,
  modelGid: string,
  dryRun: boolean,
): Promise<string | null> {
  if (dryRun) return `gid://shopify/Metaobject/dry/${handle}`;
  const q = `
    mutation UpsertFitment($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject { id handle }
        userErrors { field message }
      }
    }`;
  const data = await shopifyGql(shop, token, apiVersion, q, {
    handle: { type: FITMENT_MO_TYPE, handle },
    metaobject: {
      fields: [
        { key: "make", value: makeGid },
        { key: "model", value: modelGid },
      ],
    },
  });
  const payload = data?.data?.metaobjectUpsert as
    | { metaobject?: { id?: string }; userErrors?: { message: string }[] }
    | undefined;
  const errs = payload?.userErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
  return payload?.metaobject?.id ?? null;
}

async function setProductFitments(
  shop: string,
  token: string,
  apiVersion: string,
  productGid: string,
  fitmentGids: string[],
  dryRun: boolean,
) {
  if (dryRun) return { ok: true, count: fitmentGids.length };
  const q = `
    mutation SetFitments($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`;
  const data = await shopifyGql(shop, token, apiVersion, q, {
    metafields: [{
      ownerId: productGid,
      namespace: "custom",
      key: "fitments",
      type: "list.metaobject_reference",
      value: JSON.stringify(fitmentGids),
    }],
  });
  const payload = data?.data?.metafieldsSet as
    | { userErrors?: { message: string }[] }
    | undefined;
  const errs = payload?.userErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
  return { ok: true, count: fitmentGids.length };
}

type FitmentJoinRow = {
  product: {
    shopify_product_id?: string;
    handle?: string;
    track_size?: string;
    tread_pattern?: string;
  } | null;
  model: { model_key?: string; shopify_metaobject_gid?: string; make?: string } | null;
};

/**
 * Fetch every eligible fitment row, ordered for deterministic offset/limit windows and
 * paginated past PostgREST's default row cap so no product is silently dropped.
 */
async function fetchAllFitmentRows(
  sb: ReturnType<typeof createClient>,
): Promise<FitmentJoinRow[]> {
  const all: FitmentJoinRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("fitment")
      .select(
        "product:product_id(shopify_product_id, handle, track_size, tread_pattern), model:model_id(model_key, shopify_metaobject_gid, make)",
      )
      .eq("fit_type", "track")
      .order("product_id", { ascending: true })
      .order("model_id", { ascending: true })
      .range(from, from + FITMENT_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data || []) as unknown as FitmentJoinRow[];
    all.push(...batch);
    if (batch.length < FITMENT_PAGE_SIZE) break;
    from += FITMENT_PAGE_SIZE;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 50);
    const offset = Math.max(Number(body.offset) || 0, 0);
    const handleFilter = body.handle ? String(body.handle) : null;
    const allowPartial = body.allow_partial === true;

    // Fail-closed auth: live writes require a configured, matching key. Dry runs (read-only)
    // are permitted without a key, but a supplied-but-wrong key is always rejected.
    const syncKey = Deno.env.get("SYNC_API_KEY");
    const got = req.headers.get("x-sync-key") || new URL(req.url).searchParams.get("key");
    if (!dryRun) {
      if (!syncKey) {
        return json({ error: "SYNC_API_KEY not configured; refusing live sync (fail-closed)" }, 403);
      }
      if (got !== syncKey) return json({ error: "unauthorized" }, 401);
    } else if (syncKey && got && got !== syncKey) {
      return json({ error: "unauthorized" }, 401);
    }

    const shop = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
    const apiVersion = Deno.env.get("SHOPIFY_API_VERSION") || "2025-10";
    if (!shop || !token) {
      return json({ error: "Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN secrets" }, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: makeRows, error: makeErr } = await sb.from("make_map").select("handle,gid,name");
    if (makeErr) return json({ error: makeErr.message }, 500);
    const makes = (makeRows || []) as MakeRow[];

    const [{ data: trackRows }, { data: variantRows }] = await Promise.all([
      sb.from("shopify_track_map").select("handle,product_id"),
      sb.from("shopify_variant_map").select("handle,size_digits,tread"),
    ]);
    const trackByHandle = new Map(
      ((trackRows || []) as TrackMapRow[]).map((r) => [r.handle, r.product_id]),
    );
    const variantByKey = new Map(
      ((variantRows || []) as VariantMapRow[]).map((r) => [`${r.size_digits}::${r.tread}`, r.handle]),
    );

    let fitmentRows: FitmentJoinRow[];
    try {
      fitmentRows = await fetchAllFitmentRows(sb);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }

    const rows: FitRow[] = [];
    const seen = new Set<string>();
    for (const r of fitmentRows) {
      const product = r.product;
      const model = r.model;
      if (!model?.shopify_metaobject_gid || !model.model_key) continue;
      const resolved = resolveProductGid(product, variantByKey, trackByHandle);
      if (!resolved.gid) continue;
      if (handleFilter && resolved.handle !== handleFilter && product?.handle !== handleFilter) continue;
      const dedupe = `${resolved.gid}::${model.model_key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      rows.push({
        shopify_product_id: resolved.gid,
        product_handle: resolved.handle || product?.handle || "",
        model_key: model.model_key,
        model_gid: model.shopify_metaobject_gid,
        make_raw: model.make || "",
      });
    }

    const byProduct = new Map<string, FitRow[]>();
    for (const row of rows) {
      if (!byProduct.has(row.shopify_product_id)) byProduct.set(row.shopify_product_id, []);
      byProduct.get(row.shopify_product_id)!.push(row);
    }

    const allProductIds = [...byProduct.keys()];
    const productIds = allProductIds.slice(offset, offset + limit);
    const results: Record<string, unknown>[] = [];
    let productsWritten = 0;

    for (const productGid of productIds) {
      const items = byProduct.get(productGid) || [];
      const handle = items[0]?.product_handle || productGid;
      const fitmentGids: string[] = [];
      const skipped: string[] = [];

      for (const item of items) {
        const makeGid = resolveMakeGid(item.make_raw, makes);
        if (!makeGid) {
          skipped.push(`${item.model_key}:no_make_gid(${item.make_raw})`);
          continue;
        }
        const moHandle = `fit-${item.model_key}`.slice(0, 63);
        try {
          const fid = await upsertFitmentMo(
            shop, token, apiVersion, moHandle, makeGid, item.model_gid, dryRun,
          );
          if (fid) fitmentGids.push(fid);
          else skipped.push(`${item.model_key}:null_metaobject_id`);
        } catch (e) {
          skipped.push(`${item.model_key}:${String(e)}`);
        }
      }

      const uniqueGids = [...new Set(fitmentGids)];
      const complete = skipped.length === 0;

      // All-or-nothing: never overwrite a product's fitments with a partial list. A product
      // with any unresolved model is deferred (its existing Shopify data is left intact) unless
      // the caller explicitly opts into partial writes.
      if (!complete && !allowPartial) {
        results.push({
          handle,
          product_gid: productGid,
          deferred: true,
          reason: "incomplete_resolution",
          fitments_ready: uniqueGids.length,
          models_total: items.length,
          skipped: skipped.slice(0, 8),
          dry_run: dryRun,
        });
        continue;
      }

      try {
        if (uniqueGids.length) {
          await setProductFitments(shop, token, apiVersion, productGid, uniqueGids, dryRun);
          if (!dryRun) productsWritten += 1;
        }
        results.push({
          handle,
          product_gid: productGid,
          fitments_set: uniqueGids.length,
          models_total: items.length,
          partial: !complete,
          skipped: skipped.slice(0, 8),
          dry_run: dryRun,
        });
      } catch (e) {
        results.push({ handle, product_gid: productGid, error: String(e), skipped: skipped.slice(0, 8) });
      }
    }

    const deferred = results.filter((r) => r.deferred).length;
    const errored = results.filter((r) => r.error).length;

    if (!dryRun && productsWritten) {
      await sb.from("tracktech_audit_log").insert({
        event_type: "shopify_sync",
        event_title: "Product fitments synced",
        event_summary:
          `Wrote custom.fitments on ${productsWritten} products (${deferred} deferred, ${errored} errored)`,
        related_table: "product",
        actor: "sync-product-fitments",
        confidence: "verified",
        new_value: { products_written: productsWritten, deferred, errored, limit, offset },
      });
    }

    return json({
      dry_run: dryRun,
      products_in_catalog: byProduct.size,
      offset,
      limit,
      remaining: Math.max(allProductIds.length - offset - results.length, 0),
      processed: results.length,
      products_written: productsWritten,
      deferred,
      errored,
      results,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
