#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const catalogPath = valueArg("--catalog", path.resolve("../../outputs/HEAVY_IRON_LLM_CATALOG.json"));
const outPath = valueArg("--out", path.resolve("workers/data/agentic-catalog.js"));
const store = valueArg("--store", "tracktech-530.myshopify.com");

function valueArg(name, fallback) {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function variantNumericId(gid) {
  const match = String(gid || "").match(/ProductVariant\/(\d+)/);
  return match ? match[1] : "";
}

function applicationForTread(treadPattern) {
  const tread = clean(treadPattern).toLowerCase();
  if (/\bc[- ]?block\b|\bc pattern\b/.test(tread)) {
    return {
      family: "C-Block",
      terrain: ["Concrete", "Jagged Rock", "Asphalt", "Sharp Gravel"],
      industry: ["Demolition", "Paving", "Concrete Removal"],
      climate: ["All-Weather"],
      vocation_hubs: ["demolition-tracks"],
      benefit: "Stabilizes hard-surface work, reduces vibration on pavement, and helps resist chunking from concrete and sharp aggregate.",
    };
  }
  if (/\bz[- ]?max\b|\bzig\b|\bmud\b/.test(tread)) {
    return {
      family: "Z-Max",
      terrain: ["Deep Mud", "Swamp", "Loose Clay", "Wet Slop"],
      industry: ["Forestry", "Excavation", "Site Prep"],
      climate: ["High-Precipitation"],
      vocation_hubs: ["deep-mud-tracks"],
      benefit: "Clears mud aggressively and maintains forward bite in wet soil, swamp, and loose clay conditions.",
    };
  }
  if (/\bmulti[- ]?bar\b|\bsnow\b|\bwinter\b/.test(tread)) {
    return {
      family: "Multi-Bar",
      terrain: ["Snow", "Ice", "Slush", "Hard-Pack"],
      industry: ["Snow Removal", "Agriculture", "Municipal Work"],
      climate: ["Winter", "Sub-Zero"],
      vocation_hubs: ["skid-steer-snow-tracks"],
      benefit: "Adds linear biting edges for snow, ice, and slush traction where standard block patterns can skate.",
    };
  }
  if (/\bstagger\b|\bturf\b|\bblock\b/.test(tread)) {
    return {
      family: "Staggered Block",
      terrain: ["Turf", "Finished Lawns", "Dry Soil", "Moderate Ground"],
      industry: ["Landscaping", "Golf Courses", "Property Maintenance"],
      climate: ["Dry", "Moderate"],
      vocation_hubs: ["landscaping-tracks"],
      benefit: "Spreads ground pressure to reduce turf disturbance while keeping enough bite for mixed landscaping work.",
    };
  }
  if (/\ball[- ]?terrain\b|\bgeneral\b|\bmixed\b/.test(tread)) {
    return {
      family: "All-Terrain",
      terrain: ["Dirt", "Clay", "Gravel", "Mixed Subdivisions"],
      industry: ["Excavation", "Site Prep", "General Construction"],
      climate: ["All-Weather"],
      vocation_hubs: ["general-construction-tracks"],
      benefit: "Balances ride quality, self-cleaning, and traction across everyday dirt, clay, gravel, and mixed construction surfaces.",
    };
  }
  return null;
}

function shopifyGql(query, variables = {}) {
  const cmd = ["store", "execute", "--store", store, "--query", query, "--json"];
  if (Object.keys(variables).length) cmd.push("--variables", JSON.stringify(variables));
  const stdout = execFileSync("shopify", cmd, {
    encoding: "utf8",
    env: {
      ...process.env,
      SHOPIFY_CLI_AGENT_INFO: "n:codex|v:1|p:openai",
      SHOPIFY_CLI_AGENT_IDS: "s:heavy-iron-theme|r:agentic-catalog|i:codex-desktop",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const jsonStart = stdout.indexOf("{");
  return JSON.parse(jsonStart >= 0 ? stdout.slice(jsonStart) : stdout);
}

function allShopifyProducts() {
  const query = `
    query Products($cursor: String) {
      products(first: 250, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          handle
          title
          status
          variants(first: 100) {
            nodes { id sku price inventoryQuantity }
          }
        }
      }
    }`;
  const out = [];
  let cursor = null;
  do {
    const data = shopifyGql(query, { cursor });
    const conn = data.products;
    out.push(...(conn?.nodes || []));
    cursor = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

function compactItem(item, liveMaps) {
  const liveProduct = liveMaps.byProductId.get(item.shopify?.product_id) || liveMaps.byVariantId.get(item.shopify?.variant_id);
  const liveVariant = liveMaps.variantById.get(item.shopify?.variant_id);
  const models = (item.compatible_models || []).slice(0, 60).map((fit) => ({
    make: clean(fit.make),
    model: clean(fit.model),
    key: clean(fit.model_key),
    type: clean(fit.machine_type),
  }));
  return {
    sku: clean(item.sku),
    mpn: clean(item.mpn),
    title: clean(liveProduct?.title || item.title),
    handle: clean(liveProduct?.handle || item.handle),
    url_path: liveProduct?.handle ? `/products/${liveProduct.handle}` : clean(item.url_path),
    price: Number(liveVariant?.price || item.price || 0),
    in_stock: liveProduct?.status ? liveProduct.status === "ACTIVE" && Number(liveVariant?.inventoryQuantity || 0) > 0 : Boolean(item.in_stock),
    stock: liveVariant?.inventoryQuantity ?? (item.in_stock ? 999 : 0),
    variant_id: variantNumericId(item.shopify?.variant_id),
    track: item.track
      ? {
          size: clean(item.track.size),
          width_mm: item.track.width_mm || null,
          width_in: item.track.width_in || null,
          pitch_mm: item.track.pitch_mm || null,
          pitch_type: clean(item.track.pitch_type),
          links: item.track.links || null,
          tread_pattern: clean(item.track.tread_pattern),
          application: applicationForTread(item.track.tread_pattern),
          guaranteed_drop_in_fit: item.track.boolean_claims?.guaranteed_drop_in_fit !== false,
        }
      : null,
    models,
  };
}

function markdownFor(items, generatedAt) {
  const hero = items
    .filter((item) => item.track && item.in_stock)
    .sort((a, b) => String(a.track.size).localeCompare(String(b.track.size)))
    .slice(0, 350);
  const rows = hero.map((item) => {
    const models = item.models
      .slice(0, 8)
      .map((model) => `${model.make} ${model.model}`.trim())
      .filter(Boolean)
      .join("; ");
    return `| ${item.sku || item.mpn} | ${item.track.size} | ${item.track.width_in || ""} | ${item.track.pitch_mm || ""}${item.track.pitch_type || ""} | ${item.track.links || ""} | ${item.track.tread_pattern || ""} | $${item.price || ""} | ${item.stock} | ${models} | https://heavyironsupply.com${item.url_path} |`;
  });
  return `# Heavy Iron Supply Co. Agentic Catalog

> Machine-readable heavy equipment parts catalog for AI shopping agents.
> Generated: ${generatedAt}

Heavy Iron Supply Co. sells rubber tracks, undercarriage parts, and attachments for compact track loaders, skid steers, and mini excavators.

## Agent Tools

- OpenAPI spec: https://heavyironsupply.com/openapi.json
- Fitment and stock: https://heavyironsupply.com/api/agentic/check-fitment-and-stock
- LTL freight estimate: https://heavyironsupply.com/api/agentic/calculate-ltl-freight
- Checkout link generation: https://heavyironsupply.com/api/agentic/generate-checkout-link

## Safety Rules For Fitment

- Never substitute A-pitch and B-pitch tracks.
- Match width, pitch, pitch type, and link count before recommending a track.
- If the stamped track size on the old rubber does not match the product size, ask the buyer to confirm before purchase.
- Lower 48 commercial freight is free. Residential or lift-gate delivery may require an accessorial fee.
- Orders placed before 2:00 PM EST ship the same business day when inventory is available.

## In-Stock Rubber Track Matrix

| SKU | Size | Width In | Pitch | Links | Tread | Price | Stock | Fits | URL |
| --- | --- | ---: | --- | ---: | --- | ---: | ---: | --- | --- |
${rows.join("\n")}
`;
}

if (!fs.existsSync(catalogPath)) {
  console.error(`Missing catalog: ${catalogPath}`);
  process.exit(1);
}

const feed = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
let liveProducts = [];
try {
  liveProducts = allShopifyProducts();
} catch (error) {
  console.warn(`Live Shopify enrichment failed, using catalog handles only: ${error.message}`);
}
const liveMaps = {
  byProductId: new Map(),
  byVariantId: new Map(),
  variantById: new Map(),
};
for (const product of liveProducts) {
  liveMaps.byProductId.set(product.id, product);
  for (const variant of product.variants?.nodes || []) {
    liveMaps.byVariantId.set(variant.id, product);
    liveMaps.variantById.set(variant.id, variant);
  }
}
const items = (feed.items || []).map((item) => compactItem(item, liveMaps)).filter((item) => item.handle && (item.sku || item.mpn));
const generatedAt = new Date().toISOString();
const llms = markdownFor(items, generatedAt);
const out = `// Generated by scripts/generate-agentic-worker-data.mjs
export const GENERATED_AT = ${JSON.stringify(generatedAt)};
export const BRAND = "Heavy Iron Supply Co.";
export const STORE_ORIGIN = "https://heavyironsupply.com";
export const CATALOG_ITEMS = ${JSON.stringify(items)};
export const LLMS_TXT = ${JSON.stringify(llms)};
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);
const fitmentNodeCount = items.reduce((count, item) => count + (item.track ? item.models.length : 0), 0);
console.log(JSON.stringify({ outPath, items: items.length, fitment_nodes: fitmentNodeCount, bytes: out.length }, null, 2));
