import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * catalog-search — Semantic product search with Shopify handle enrichment.
 *
 * POST { q: string, limit?: number (max 12) }
 * Proxies the deployed `search` edge function, then maps Supabase product rows
 * to Shopify storefront URLs via shopify_product_id / variant + track maps.
 *
 * Deploy: supabase functions deploy catalog-search --no-verify-jwt
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  "Fitment Reference": "directional",
};

type SearchHit = {
  id: string;
  source_type?: string | null;
  label?: string | null;
  track_size?: string | null;
  tread_pattern?: string | null;
  make?: string | null;
  model?: string | null;
  snippet?: string | null;
  shopify_handle?: string | null;
  url?: string | null;
  image_url?: string | null;
  image_alt?: string | null;
  price?: number | null;
  similarity?: number;
};

type ProductRow = {
  id: string;
  handle?: string | null;
  shopify_product_id?: string | null;
  track_size?: string | null;
  tread_pattern?: string | null;
  image_url?: string | null;
  image_alt?: string | null;
  media_role?: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

function sizeDigitsFromTrackSize(trackSize: string): string {
  return (trackSize || "").replace(/[^0-9]/g, "");
}

function resolveShopifyHandle(
  product: ProductRow | undefined,
  variantByKey: Map<string, string>,
  trackByHandle: Map<string, string>,
  gidToHandle: Map<string, string>,
): string | null {
  if (!product) return null;
  if (product.shopify_product_id) {
    const fromGid = gidToHandle.get(product.shopify_product_id);
    if (fromGid) return fromGid;
  }
  const tread = TREAD_TO_SHOPIFY[product.tread_pattern || ""];
  const digits = sizeDigitsFromTrackSize(product.track_size || "");
  if (!tread || !digits) return null;
  const shopifyHandle = variantByKey.get(`${digits}::${tread}`);
  if (!shopifyHandle) return null;
  return shopifyHandle;
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
  if (!r.ok) throw new Error(`Shopify HTTP ${r.status}`);
  return data;
}

async function shopifyHandleFromProductGid(
  gid: string,
  shop: string,
  token: string,
  apiVersion: string,
): Promise<string | null> {
  const data = await shopifyGql(
    shop,
    token,
    apiVersion,
    "query ProductHandle($id: ID!) { product(id: $id) { handle } }",
    { id: gid },
  );
  return data?.data?.product?.handle ?? null;
}

async function shopifySearchHandle(
  digits: string,
  treadPattern: string,
  shop: string,
  token: string,
  apiVersion: string,
): Promise<string | null> {
  if (!digits) return null;
  const tread = TREAD_TO_SHOPIFY[treadPattern] || "";
  const data = await shopifyGql(
    shop,
    token,
    apiVersion,
    "query Search($q: String!) { products(first: 6, query: $q) { nodes { handle title } } }",
    { q: `title:*${digits}*` },
  );
  const nodes: { handle: string; title: string }[] = data?.data?.products?.nodes || [];
  for (const n of nodes) {
    const blob = `${n.handle} ${n.title}`.toLowerCase();
    if (!blob.replace(/[^0-9]/g, "").includes(digits)) continue;
    if (tread && !blob.includes(tread.replace("-", " ")) && !blob.includes(tread)) continue;
    return n.handle;
  }
  return nodes[0]?.handle ?? null;
}

async function selectProductsWithImageFallback(supabase: ReturnType<typeof createClient>, ids: string[]) {
  const withImages = await supabase
    .from("product")
    .select("id, handle, shopify_product_id, track_size, tread_pattern, image_url, image_alt, media_role")
    .in("id", ids);

  if (!withImages.error) return withImages.data || [];

  const fallback = await supabase
    .from("product")
    .select("id, handle, shopify_product_id, track_size, tread_pattern")
    .in("id", ids);

  if (fallback.error) throw fallback.error;
  return fallback.data || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const q = String(body.q || "").trim();
    const limit = Math.min(Math.max(Number(body.limit || 8), 1), 12);
    if (!q) return json({ error: "missing q" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const searchRes = await fetch(`${supabaseUrl}/functions/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ q, limit }),
    });
    if (!searchRes.ok) {
      const errText = await searchRes.text();
      return json({ error: "search_failed", detail: errText }, 502);
    }
    const searchPayload = await searchRes.json();
    const hits: SearchHit[] = searchPayload.results || [];
    if (!hits.length) return json({ query: q, results: [] });

    const ids = hits.map((h) => h.id).filter(Boolean);
    const [products, { data: variantRows }, { data: trackRows }] = await Promise.all([
      selectProductsWithImageFallback(supabase, ids),
      supabase.from("shopify_variant_map").select("handle, size_digits, tread"),
      supabase.from("shopify_track_map").select("handle, product_id"),
    ]);

    const productById = new Map((products || []).map((p: ProductRow) => [p.id, p]));
    const variantByKey = new Map<string, string>();
    for (const row of variantRows || []) {
      variantByKey.set(`${row.size_digits}::${row.tread}`, row.handle);
    }
    const trackByHandle = new Map<string, string>();
    const gidToHandle = new Map<string, string>();
    for (const row of trackRows || []) {
      trackByHandle.set(row.handle, row.product_id);
      if (row.product_id) gidToHandle.set(row.product_id, row.handle);
    }

    const results = await Promise.all(hits.map(async (hit) => {
      const product = productById.get(hit.id);
      let shopifyHandle = hit.shopify_handle || resolveShopifyHandle(product, variantByKey, trackByHandle, gidToHandle);
      const trackSize = hit.track_size || product?.track_size || "";
      const tread = hit.tread_pattern || product?.tread_pattern || "";
      const label = hit.label || [trackSize, tread].filter(Boolean).join(" · ") || [hit.make, hit.model].filter(Boolean).join(" ");
      const imageUrl = hit.image_url || product?.image_url || null;
      const imageAlt = hit.image_alt || product?.image_alt || label || null;
      const shop = Deno.env.get("SHOPIFY_STORE_DOMAIN");
      const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
      const apiVersion = Deno.env.get("SHOPIFY_API_VERSION") || "2025-10";

      if (!shopifyHandle && product && shop && token) {
        try {
          if (product.shopify_product_id) {
            shopifyHandle = await shopifyHandleFromProductGid(
              product.shopify_product_id,
              shop,
              token,
              apiVersion,
            );
          }
          if (!shopifyHandle) {
            shopifyHandle = await shopifySearchHandle(
              sizeDigitsFromTrackSize(trackSize),
              tread,
              shop,
              token,
              apiVersion,
            );
          }
        } catch (_e) {
          shopifyHandle = null;
        }
      }

      return {
        id: hit.id,
        source_type: hit.source_type || (product ? "product" : null),
        label,
        track_size: trackSize,
        tread_pattern: tread,
        make: hit.make || null,
        model: hit.model || null,
        snippet: hit.snippet || null,
        image_url: imageUrl,
        image_alt: imageAlt,
        media_role: product?.media_role || null,
        price: hit.price ?? null,
        similarity: hit.similarity ?? null,
        shopify_handle: shopifyHandle,
        url: hit.url || (shopifyHandle ? `/products/${shopifyHandle}` : null),
      };
    }));

    return json({ query: q, results });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
