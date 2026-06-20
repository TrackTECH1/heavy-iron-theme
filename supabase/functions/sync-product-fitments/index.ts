import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * sync-product-fitments — Publish Supabase fitment rows → Shopify product custom.fitments
 *
 * POST { dry_run?: boolean (default true), limit?: number (max 50), offset?: number, handle?: string }
 * Headers: x-sync-key (optional, matches SYNC_API_KEY secret)
 *
 * Requires Supabase secrets: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN
 * Optional: SHOPIFY_API_VERSION (default 2025-10), SYNC_API_KEY
 *
 * Deploy: supabase functions deploy sync-product-fitments --no-verify-jwt
 * Run dry:  curl -X POST .../sync-product-fitments -d '{"dry_run":true,"limit":5}'
 * Run live: curl -X POST .../sync-product-fitments -H 'x-sync-key: ...' -d '{"dry_run":false,"limit":25}'
 * Cron: pg_cron job tt-sync-product-fitments @ 07:20 UTC (see supabase/migrations/*schedule_sync_product_fitments_cron*)
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FITMENT_MO_TYPE = "fitment";

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

async function shopifyGql(
  shop: string,
  token: string,
  apiVersion: string,
  query: string,
  variables: Record<string, unknown> = {},
) {
  const r = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${JSON.stringify(data)}`);
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
  const payload = data?.data?.metaobjectUpsert;
  const errs = payload?.userErrors || [];
  if (errs.length) throw new Error(errs.map((e: { message: string }) => e.message).join("; "));
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
  const errs = data?.data?.metafieldsSet?.userErrors || [];
  if (errs.length) throw new Error(errs.map((e: { message: string }) => e.message).join("; "));
  return { ok: true, count: fitmentGids.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const syncKey = Deno.env.get("SYNC_API_KEY");
    if (syncKey) {
      const got = req.headers.get("x-sync-key") || new URL(req.url).searchParams.get("key");
      if (got !== syncKey) return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const limit = Math.min(Number(body.limit || 10), 50);
    const offset = Math.max(Number(body.offset || 0), 0);
    const handleFilter = body.handle ? String(body.handle) : null;

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

    const { data, error } = await sb
      .from("fitment")
      .select("product:product_id(shopify_product_id, handle, track_size, tread_pattern), model:model_id(model_key, shopify_metaobject_gid, make)")
      .eq("fit_type", "track");
    if (error) return json({ error: error.message }, 500);

    const rows: FitRow[] = [];
    const seen = new Set<string>();
    for (const r of data || []) {
      const product = r.product as {
        shopify_product_id?: string;
        handle?: string;
        track_size?: string;
        tread_pattern?: string;
      } | null;
      const model = r.model as { model_key?: string; shopify_metaobject_gid?: string; make?: string } | null;
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
        } catch (e) {
          skipped.push(`${item.model_key}:${String(e)}`);
        }
      }

      const uniqueGids = [...new Set(fitmentGids)];
      try {
        if (uniqueGids.length) {
          await setProductFitments(shop, token, apiVersion, productGid, uniqueGids, dryRun);
        }
        results.push({
          handle,
          product_gid: productGid,
          fitments_set: uniqueGids.length,
          models_total: items.length,
          skipped: skipped.slice(0, 8),
          dry_run: dryRun,
        });
      } catch (e) {
        results.push({ handle, error: String(e), skipped: skipped.slice(0, 8) });
      }
    }

    if (!dryRun && results.length) {
      await sb.from("tracktech_audit_log").insert({
        event_type: "shopify_sync",
        event_title: "Product fitments synced",
        event_summary: `Synced custom.fitments on ${results.length} products`,
        related_table: "product",
        actor: "sync-product-fitments",
        confidence: "verified",
        new_value: { products: results.length, limit },
      });
    }

    return json({
      dry_run: dryRun,
      products_in_catalog: byProduct.size,
      offset,
      limit,
      remaining: Math.max(allProductIds.length - offset - results.length, 0),
      processed: results.length,
      results,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
