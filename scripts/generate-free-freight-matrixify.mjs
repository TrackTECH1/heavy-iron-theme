#!/usr/bin/env node
/**
 * Generate Matrixify Products import for free Lower-48 LTL freight messaging.
 *
 * This is product-level messaging/metafields only. Variant inventory tracker,
 * quantity, and 430 lb weight repairs stay in
 * HEAVY_IRON_MATRIXIFY_TRACK_FREIGHT_INVENTORY_REPAIR.csv.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const STORE = valueArg("--store", "tracktech-530.myshopify.com");
const OUT = valueArg(
  "--out",
  path.resolve("../../outputs/HEAVY_IRON_MATRIXIFY_FREE_FREIGHT_PRODUCT_MESSAGING.csv"),
);
const SUMMARY_OUT = valueArg(
  "--summary",
  path.resolve("../../outputs/HEAVY_IRON_FREE_FREIGHT_MATRIXIFY_SUMMARY.json"),
);

function valueArg(name, fallback) {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    out[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^['"]|['"]$/g, "");
  }
  return out;
}

function findUp(startDir, filename) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, filename);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const envPath = findUp(process.cwd(), ".env.local");
const env = { ...loadEnvFile(envPath), ...process.env };
const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SECRET_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL and service/secret key.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

function shopifyGql(query, variables = {}) {
  const cmd = ["store", "execute", "--store", STORE, "--query", query, "--json"];
  if (Object.keys(variables).length) cmd.push("--variables", JSON.stringify(variables));
  const stdout = execFileSync("shopify", cmd, {
    encoding: "utf8",
    env: {
      ...process.env,
      SHOPIFY_CLI_AGENT_INFO: "n:codex|v:1|p:openai",
      SHOPIFY_CLI_AGENT_IDS: "s:heavy-iron-theme|r:free-freight-matrixify|i:codex-desktop",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const jsonStart = stdout.indexOf("{");
  return JSON.parse(jsonStart >= 0 ? stdout.slice(jsonStart) : stdout);
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeCsv(filePath, rows, headers) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n"),
  );
}

async function fetchAll(table, select, order = "id") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select(select).range(from, from + 999);
    if (order) query = query.order(order, { ascending: true });
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
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
          productType
          variants(first: 100) { nodes { id sku title } }
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

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function parseSize(trackSize) {
  const raw = clean(trackSize);
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)([A-Za-z]*)\s*x\s*(\d+)/i);
  if (!match) return {};
  const widthMm = Number(match[1]);
  return {
    width_mm: widthMm,
    width_in: Number.isFinite(widthMm) ? Math.round((widthMm / 25.4) * 100) / 100 : null,
    pitch_mm: Number(match[2]),
    pitch_type: match[3] || null,
    links: Number(match[4]),
  };
}

function freeFreightFallback(product) {
  const parsed = parseSize(product.track_size);
  return {
    text: `Premium ${parsed.width_in ? `${Math.round(parsed.width_in)}-inch ` : ""}(${product.track_size}) heavy-duty rubber track replacement. Free Fast LTL Freight to the Lower 48, with 1-3 business day delivery.`,
    disclosure:
      "Free Fast LTL Freight applies to commercial addresses in the contiguous Lower 48 states. Orders placed before 2:00 PM EST ship out the exact same business day when inventory is available. Residential delivery, lift-gate service, Alaska, Hawaii, Puerto Rico, and remote accessorial services may require additional charges.",
    shipping: {
      free_ltl_freight: true,
      region: "contiguous_us_lower_48",
      handling_days_min: 0,
      handling_days_max: 1,
      transit_days_min: 1,
      transit_days_max: 3,
      same_day_cutoff_local: "14:00 EST",
      residential_or_liftgate_fee_usd: 125,
    },
    specs: {
      track_size: product.track_size,
      width_mm: product.width_mm || parsed.width_mm || null,
      width_in: parsed.width_in,
      pitch_mm: product.pitch_mm || parsed.pitch_mm || null,
      pitch_type: parsed.pitch_type || product.guide_type || null,
      links: product.links || parsed.links || null,
      tread_pattern: product.tread_pattern || null,
    },
  };
}

async function main() {
  const [shopifyProducts, products] = await Promise.all([
    Promise.resolve(allShopifyProducts()),
    fetchAll(
      "product",
      "id,product_code,sku,handle,title,track_size,width_mm,pitch_mm,links,guide_type,tread_pattern,part_type,shopify_product_id,shopify_variant_id",
    ),
  ]);

  const shopifyByProductId = new Map(shopifyProducts.map((product) => [product.id, product]));
  const shopifyByVariantId = new Map();
  const shopifyBySku = new Map();
  for (const product of shopifyProducts) {
    for (const variant of product.variants?.nodes || []) {
      if (variant.id) shopifyByVariantId.set(variant.id, product);
      if (variant.sku) shopifyBySku.set(variant.sku.trim().toUpperCase(), product);
    }
  }

  const rows = [];
  const seenHandles = new Set();
  const skipped = [];
  for (const product of products) {
    if (!product.track_size) continue;
    const shopifyProduct =
      shopifyByProductId.get(product.shopify_product_id) ||
      shopifyByVariantId.get(product.shopify_variant_id) ||
      shopifyBySku.get(String(product.sku || "").trim().toUpperCase());
    if (!shopifyProduct) {
      skipped.push({ id: product.id, sku: product.sku, handle: product.handle });
      continue;
    }
    if (seenHandles.has(shopifyProduct.handle)) continue;
    seenHandles.add(shopifyProduct.handle);
    const fallback = freeFreightFallback(product);
    rows.push({
      Handle: shopifyProduct.handle,
      Command: "MERGE",
      Tags: "Free Fast LTL Freight, Lower 48 Shipping, 1-3 Day Delivery, Heavy Iron Verified",
      "Metafield: custom.shipping_type [single_line_text_field]": "Free Fast LTL Freight (Lower 48 Only)",
      "Metafield: custom.tracktech_data_fallback [json]": JSON.stringify(fallback),
      "Metafield: custom.tracktech_data_api [json]": JSON.stringify({
        source: "supabase",
        product_id: product.id,
        product_code: product.product_code || null,
        sku: product.sku || null,
        handle: product.handle || null,
        shopify_product_id: shopifyProduct.id,
        free_ltl_freight_lower_48: true,
        residential_liftgate_fee_usd: 125,
        generated_at: new Date().toISOString(),
      }),
    });
  }

  const headers = [
    "Handle",
    "Command",
    "Tags",
    "Metafield: custom.shipping_type [single_line_text_field]",
    "Metafield: custom.tracktech_data_fallback [json]",
    "Metafield: custom.tracktech_data_api [json]",
  ];
  writeCsv(OUT, rows, headers);

  const summary = {
    output: OUT,
    rows: rows.length,
    skipped: skipped.length,
    shopify_products: shopifyProducts.length,
    supabase_products: products.length,
    skipped_sample: skipped.slice(0, 20),
  };
  fs.mkdirSync(path.dirname(SUMMARY_OUT), { recursive: true });
  fs.writeFileSync(SUMMARY_OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
