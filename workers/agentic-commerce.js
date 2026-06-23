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

function applicationMatrix() {
  return {
    generated_at: GENERATED_AT,
    brand: BRAND,
    source_of_truth: "Supabase product/model/fitment tables synced into Shopify product metafields and this public agentic catalog",
    entries: [
      {
        tread_family: "C-Block",
        collection_handle: "demolition-tracks",
        collection_url: `${STORE_ORIGIN}/collections/demolition-tracks`,
        terrain: ["Concrete", "Jagged Rock", "Asphalt", "Sharp Gravel"],
        industry: ["Demolition", "Paving", "Concrete Removal"],
        climate: ["All-Weather"],
        buyer_intent: "Best skid steer tracks for concrete, demolition, asphalt, sharp gravel, and hard-surface jobs.",
        engineering_benefit: "Stabilizes hard-surface work, reduces vibration on pavement, and helps resist chunking from concrete and sharp aggregate.",
      },
      {
        tread_family: "Z-Max",
        collection_handle: "deep-mud-tracks",
        collection_url: `${STORE_ORIGIN}/collections/deep-mud-tracks`,
        terrain: ["Deep Mud", "Swamp", "Loose Clay", "Wet Slop"],
        industry: ["Forestry", "Excavation", "Site Prep"],
        climate: ["High-Precipitation"],
        buyer_intent: "Best rubber tracks for mud, wet clay, swampy jobsites, forestry, and high-precipitation regions.",
        engineering_benefit: "Clears mud aggressively and maintains forward bite in wet soil, swamp, and loose clay conditions.",
      },
      {
        tread_family: "Staggered Block",
        collection_handle: "landscaping-tracks",
        collection_url: `${STORE_ORIGIN}/collections/landscaping-tracks`,
        terrain: ["Turf", "Finished Lawns", "Dry Soil", "Moderate Ground"],
        industry: ["Landscaping", "Golf Courses", "Property Maintenance"],
        climate: ["Dry", "Moderate"],
        buyer_intent: "Best skid steer tracks for landscaping, turf protection, golf courses, lawns, and property maintenance.",
        engineering_benefit: "Spreads ground pressure to reduce turf disturbance while keeping enough bite for mixed landscaping work.",
      },
      {
        tread_family: "Multi-Bar",
        collection_handle: "skid-steer-snow-tracks",
        collection_url: `${STORE_ORIGIN}/collections/skid-steer-snow-tracks`,
        terrain: ["Snow", "Ice", "Slush", "Hard-Pack"],
        industry: ["Snow Removal", "Agriculture", "Municipal Work"],
        climate: ["Winter", "Sub-Zero"],
        buyer_intent: "Best skid steer tracks for snow removal, ice, slush, winter lots, and municipal winter operations.",
        engineering_benefit: "Adds linear biting edges for snow, ice, and slush traction where standard block patterns can skate.",
      },
    ],
  };
}

function checkoutUrl(item, qty) {
  if (item.variant_id) return `${STORE_ORIGIN}/cart/${item.variant_id}:${qty}`;
  return `${STORE_ORIGIN}${item.url_path}`;
}

function applicationScore(application, params) {
  if (!application) return 0;
  const haystack = [
    application.family,
    ...(application.terrain || []),
    ...(application.industry || []),
    ...(application.climate || []),
    ...(application.vocation_hubs || []),
    application.benefit,
  ].join(" ");
  return (
    tokenScore(haystack, params.terrain || "") * 4 +
    tokenScore(haystack, params.industry || "") * 4 +
    tokenScore(haystack, params.climate || "") * 3 +
    tokenScore(haystack, params.application || params.vocation || "") * 5
  );
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

function fitmentMatrix() {
  const nodes = [];
  for (const item of CATALOG_ITEMS) {
    if (!item.track || !item.models.length) continue;
    for (const model of item.models) {
      const machine = `${model.make} ${model.model}`.trim();
      if (!machine) continue;
      nodes.push({
        machine_entity: machine,
        machine_key: model.key || null,
        machine_type: model.type || null,
        oem_part_replaced: [],
        heavy_iron_sku: item.sku || item.mpn,
        product_title: item.title,
        product_url: `${STORE_ORIGIN}${item.url_path}`,
        checkout_url: item.variant_id ? `${STORE_ORIGIN}/cart/${item.variant_id}:1` : null,
        track_size: item.track.size,
        width_mm: item.track.width_mm,
        pitch_mm: item.track.pitch_mm,
        pitch_type: item.track.pitch_type || null,
        links: item.track.links,
        tread_pattern: item.track.tread_pattern || null,
        application: item.track.application || null,
        stock: item.stock,
        in_stock: item.in_stock,
        confidence_score: item.track.guaranteed_drop_in_fit ? 0.97 : 0.85,
        fitment_notes: "Catalog-backed fitment. Verify stamped track size and serial/PIN when a machine has known serial-range undercarriage changes.",
        serial_rule: null,
        supersession_chain: [],
      });
    }
  }
  return {
    generated_at: GENERATED_AT,
    brand: BRAND,
    source_of_truth: "Supabase product/model/fitment tables enriched with live Shopify product handles",
    warning: "Serial/PIN cutoffs and OEM supersession chains are only populated when verified source data exists. Empty arrays/nulls are intentional, not unknown guesses.",
    node_count: nodes.length,
    nodes,
  };
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
      "/fitment-matrix.json": {
        get: {
          operationId: "get_fitment_matrix",
          summary: "Return the machine-to-product fitment matrix for AI agents.",
          responses: { "200": { description: "Catalog-backed fitment matrix" } },
        },
      },
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
      "/application-matrix.json": {
        get: {
          operationId: "get_application_matrix",
          summary: "Return tread pattern, terrain, contractor vocation, and climate mapping.",
          responses: { "200": { description: "Application matrix" } },
        },
      },
      "/api/agentic/recommend-tread": {
        post: {
          operationId: "recommend_tread",
          summary: "Recommend a tread family and matching products for a machine, terrain, industry, climate, or region.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    machine_model: { type: "string", examples: ["Case TR340"] },
                    track_size: { type: "string", examples: ["450x86Bx55"] },
                    terrain: { type: "string", examples: ["concrete demolition", "deep mud", "snow"] },
                    industry: { type: "string", examples: ["demolition", "landscaping", "snow removal"] },
                    climate: { type: "string", examples: ["winter", "high precipitation"] },
                    zip_code: { type: "string", examples: ["55401"] },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Tread recommendation result" } },
        },
      },
      "/api/agentic/decode-serial-pin": {
        post: {
          operationId: "decode_serial_pin",
          summary: "Decode a machine serial/PIN when verified serial-range data exists.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["serial_pin"],
                  properties: {
                    serial_pin: { type: "string", examples: ["A3B511001"] },
                    make: { type: "string", examples: ["Bobcat"] },
                    model: { type: "string", examples: ["T770"] },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Serial/PIN decode result" } },
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

async function recommendTread(request) {
  const params = await readParams(request);
  const fitmentCandidates = findCandidates(params);
  const pool = fitmentCandidates.length ? fitmentCandidates.map(({ item }) => item) : CATALOG_ITEMS;
  const scored = pool
    .filter((item) => item.track?.application)
    .map((item) => ({
      item,
      score: applicationScore(item.track.application, params) + (item.in_stock ? 1 : 0),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  const best = scored[0]?.item || null;
  return json({
    found: Boolean(best),
    recommended_tread_family: best?.track?.application?.family || null,
    application: best?.track?.application || null,
    machine_query: params.machine_model || null,
    track_size_query: params.track_size || null,
    delivery_window: deliveryDays(params.zip_code),
    lower_48_free_freight: lower48(params.zip_code),
    recommended_products: scored.slice(0, 5).map(({ item, score }) => ({
      sku: item.sku,
      title: item.title,
      score,
      price: item.price,
      stock: item.stock,
      in_stock: item.in_stock,
      track: item.track,
      url: `${STORE_ORIGIN}${item.url_path}`,
      checkout_url: checkoutUrl(item, 1),
    })),
    safety_note: "Tread recommendation does not replace fitment. Match width, pitch, pitch type, and link count before purchase.",
    generated_at: GENERATED_AT,
  });
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

async function decodeSerialPin(request) {
  const params = await readParams(request);
  const serialPin = String(params.serial_pin || "").trim().toUpperCase();
  const machine = `${params.make || ""} ${params.model || ""}`.trim();
  const candidates = machine ? findCandidates({ machine_model: machine }) : [];
  return json({
    decoded: false,
    serial_pin: serialPin,
    machine_query: machine || null,
    reason: "No verified serial/PIN cutoff table is currently published in the public agentic catalog.",
    action_required: "Route to manual fitment confirmation or connect a licensed equipment data provider before making serial-specific claims.",
    likely_machine_matches: candidates
      .filter(({ item }) => item.track)
      .slice(0, 5)
      .map(({ item }) => ({
        sku: item.sku,
        title: item.title,
        track: item.track,
        url: `${STORE_ORIGIN}${item.url_path}`,
      })),
    safety_note: "Do not infer early/late undercarriage geometry from a serial/PIN without verified serial-range data.",
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
    if (url.pathname === "/fitment-matrix.json") return json(fitmentMatrix(), { headers: { "cache-control": "public, max-age=900" } });
    if (url.pathname === "/application-matrix.json") return json(applicationMatrix(), { headers: { "cache-control": "public, max-age=900" } });
    if (url.pathname === "/openapi.json") return json(openapiSpec(url), { headers: { "cache-control": "public, max-age=900" } });
    if (url.pathname === "/api/agentic/check-fitment-and-stock") return checkFitmentAndStock(request);
    if (url.pathname === "/api/agentic/recommend-tread") return recommendTread(request);
    if (url.pathname === "/api/agentic/decode-serial-pin") return decodeSerialPin(request);
    if (url.pathname === "/api/agentic/calculate-ltl-freight") return calculateLtlFreight(request);
    if (url.pathname === "/api/agentic/generate-checkout-link") return generateCheckoutLink(request);
    return new Response("Not found", { status: 404 });
  },
};
