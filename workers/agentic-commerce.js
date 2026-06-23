import { BRAND, CATALOG_ITEMS, GENERATED_AT, LLMS_TXT, STORE_ORIGIN } from "./data/agentic-catalog.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function text(data, contentType = "text/plain; charset=utf-8") {
  return new Response(data, { headers: { "content-type": contentType, "cache-control": "public, max-age=900" } });
}

function clean(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenScore(haystack, needle) {
  const tokens = clean(needle).split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const normalized = clean(haystack);
  return tokens.reduce((score, token) => score + (normalized.includes(token) ? 1 : 0), 0) / tokens.length;
}

function lower48(zipCode) {
  const zip = String(zipCode || "").trim();
  if (!/^\d{5}$/.test(zip)) return true;
  const prefix = Number(zip.slice(0, 3));
  if (prefix >= 995 && prefix <= 999) return false;
  if (prefix >= 967 && prefix <= 969) return false;
  return true;
}

function deliveryDays(zipCode) {
  const zip = String(zipCode || "").trim();
  if (!/^\d{5}$/.test(zip)) return { min: 1, max: 3 };
  const first = Number(zip[0]);
  if (first >= 3 && first <= 7) return { min: 1, max: 2 };
  return { min: 2, max: 3 };
}

function checkoutUrl(item, qty) {
  if (item.variant_id) return `${STORE_ORIGIN}/cart/${item.variant_id}:${qty}`;
  return `${STORE_ORIGIN}${item.url_path}`;
}

function findCandidates({ machine_model, sku, track_size }) {
  const skuNeedle = clean(sku);
  const trackNeedle = clean(track_size);
  const machineNeedle = clean(machine_model);
  return CATALOG_ITEMS.map((item) => {
    let score = 0;
    if (skuNeedle && [item.sku, item.mpn].some((value) => clean(value) === skuNeedle)) score += 10;
    if (trackNeedle && clean(item.track?.size) === trackNeedle) score += 6;
    if (machineNeedle) {
      const modelText = item.models.map((model) => `${model.make} ${model.model} ${model.key}`).join(" ");
      score += tokenScore(modelText, machine_model) * 5;
    }
    if (item.in_stock) score += 1;
    return { item, score };
  })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

async function readParams(request) {
  const url = new URL(request.url);
  if (request.method === "POST") {
    const type = request.headers.get("content-type") || "";
    if (type.includes("application/json")) return request.json();
  }
  return Object.fromEntries(url.searchParams.entries());
}

function openapiSpec(url) {
  const origin = `${url.protocol}//${url.host}`;
  return {
    openapi: "3.1.0",
    info: {
      title: `${BRAND} Agentic Shopping API`,
      version: "2026-06-22",
      description: "Read-only fitment, stock, LTL freight, and checkout-link tools for AI shopping agents.",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/agentic/check-fitment-and-stock": {
        post: {
          operationId: "check_fitment_and_stock",
          summary: "Check whether a track fits a machine and is in stock.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    machine_model: { type: "string", examples: ["Case TR340", "Bobcat T740"] },
                    zip_code: { type: "string", examples: ["75201"] },
                    sku: { type: "string" },
                    track_size: { type: "string", examples: ["450x86Bx55"] },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Fitment and stock result" } },
        },
      },
      "/api/agentic/calculate-ltl-freight": {
        post: {
          operationId: "calculate_ltl_freight",
          summary: "Calculate Lower 48 LTL freight timing and accessorial flags.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sku", "zip_code"],
                  properties: {
                    sku: { type: "string" },
                    zip_code: { type: "string" },
                    requires_liftgate: { type: "boolean", default: false },
                    residential: { type: "boolean", default: false },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Freight quote result" } },
        },
      },
      "/api/agentic/generate-checkout-link": {
        post: {
          operationId: "generate_checkout_link",
          summary: "Generate a Shopify cart permalink for a SKU.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sku"],
                  properties: {
                    sku: { type: "string" },
                    qty: { type: "integer", minimum: 1, default: 1 },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Checkout URL result" } },
        },
      },
    },
  };
}

async function checkFitmentAndStock(request) {
  const params = await readParams(request);
  const candidates = findCandidates(params);
  const best = candidates[0]?.item || null;
  const days = deliveryDays(params.zip_code);
  return json({
    fit: Boolean(best),
    confidence: best ? Math.min(0.99, Math.max(0.72, candidates[0].score / 12)) : 0,
    stock: best?.stock || 0,
    in_stock: Boolean(best?.in_stock),
    delivery_days: days.max,
    delivery_window: days,
    lower_48_free_freight: lower48(params.zip_code),
    recommended_product: best
      ? {
          sku: best.sku,
          title: best.title,
          price: best.price,
          track: best.track,
          url: `${STORE_ORIGIN}${best.url_path}`,
          checkout_url: checkoutUrl(best, 1),
        }
      : null,
    alternatives: candidates.slice(1, 5).map(({ item }) => ({
      sku: item.sku,
      title: item.title,
      price: item.price,
      track: item.track,
      url: `${STORE_ORIGIN}${item.url_path}`,
    })),
    safety_note: "Match width, pitch, pitch type, and link count. Do not substitute A-pitch and B-pitch tracks.",
    generated_at: GENERATED_AT,
  });
}

async function calculateLtlFreight(request) {
  const params = await readParams(request);
  const item = findCandidates({ sku: params.sku })[0]?.item || null;
  const days = deliveryDays(params.zip_code);
  const isLower48 = lower48(params.zip_code);
  const accessorial = Boolean(params.requires_liftgate || params.residential);
  return json({
    sku: params.sku,
    found: Boolean(item),
    lower_48: isLower48,
    freight_price_usd: isLower48 ? 0 : null,
    accessorial_fee_usd: accessorial ? 125 : 0,
    requires_manual_quote: !isLower48,
    delivery_window: days,
    same_day_cutoff: "2:00 PM EST",
    notes: accessorial
      ? "Residential or lift-gate delivery may require a $125 accessorial fee."
      : "Commercial Lower 48 LTL freight is free when inventory is available.",
  });
}

async function generateCheckoutLink(request) {
  const params = await readParams(request);
  const qty = Math.max(1, Number(params.qty || 1));
  const item = findCandidates({ sku: params.sku })[0]?.item || null;
  return json({
    found: Boolean(item),
    sku: params.sku,
    qty,
    checkout_url: item ? checkoutUrl(item, qty) : null,
    product_url: item ? `${STORE_ORIGIN}${item.url_path}` : null,
    note: "Checkout URL uses Shopify cart permalink format when a variant ID is available.",
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: JSON_HEADERS });
    const url = new URL(request.url);
    if (url.pathname === "/llms.txt" || url.pathname === "/llm.txt" || url.pathname === "/catalog.md") {
      return text(LLMS_TXT, "text/markdown; charset=utf-8");
    }
    if (url.pathname === "/openapi.json") return json(openapiSpec(url), { headers: { "cache-control": "public, max-age=900" } });
    if (url.pathname === "/api/agentic/check-fitment-and-stock") return checkFitmentAndStock(request);
    if (url.pathname === "/api/agentic/calculate-ltl-freight") return calculateLtlFreight(request);
    if (url.pathname === "/api/agentic/generate-checkout-link") return generateCheckoutLink(request);
    return new Response("Not found", { status: 404 });
  },
};
