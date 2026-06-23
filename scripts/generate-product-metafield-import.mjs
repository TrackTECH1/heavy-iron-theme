#!/usr/bin/env node
/**
 * Generate a controlled Matrixify Products import for Heavy Iron product metafields.
 *
 * Supabase remains the source of truth. Shopify receives filter/search/display
 * metafields that the theme, Search & Discovery, and JSON-LD can consume.
 *
 * This file deliberately does not write custom.fitments. Fitment metaobject
 * references are owned by supabase/functions/sync-product-fitments.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const STORE = valueArg("--store", "tracktech-530.myshopify.com");
const OUT = valueArg(
  "--out",
  path.resolve("../../outputs/HEAVY_IRON_MATRIXIFY_PRODUCT_METAFIELDS.csv"),
);
const SUMMARY_OUT = valueArg(
  "--summary",
  path.resolve("../../outputs/HEAVY_IRON_PRODUCT_METAFIELDS_SUMMARY.json"),
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
      SHOPIFY_CLI_AGENT_IDS: "s:heavy-iron-theme|r:product-metafields|i:codex-desktop",
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

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function uniq(values) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function listValue(values, limit = 100) {
  return JSON.stringify(uniq(values).slice(0, limit));
}

function jsonValue(value) {
  return JSON.stringify(value);
}

function integer(value) {
  const n = Number.parseInt(String(value ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? String(n) : "";
}

function decimal(value) {
  const n = Number.parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? String(n) : "";
}

function parseTrackSize(trackSize) {
  const raw = normalizeText(trackSize);
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)([A-Za-z]*)\s*x\s*(\d+)/i);
  if (!match) return {};
  return {
    widthMm: match[1],
    pitchMm: match[2],
    pitchType: match[3] || "",
    links: match[4],
    key: `${match[1]}x${match[2]}${match[3] || ""}x${match[4]}`.toLowerCase(),
  };
}

function widthInches(widthMm) {
  const n = Number.parseFloat(widthMm);
  if (!Number.isFinite(n)) return "";
  return String(Math.round((n / 25.4) * 100) / 100);
}

function fallbackText(product, models) {
  const size = normalizeText(product.track_size);
  const count = models.length;
  if (size) {
    const fitText = count ? ` Fits ${count} verified equipment models.` : "";
    return `Heavy-duty ${size} rubber track. Verify width, pitch, and link count before ordering.${fitText}`;
  }
  return `${product.title || product.sku || "Heavy equipment part"} with Supabase-backed catalog data.`;
}

function searchBoosts(product, models, brands) {
  const boosts = [
    product.sku,
    product.title,
    product.product_code,
    product.mpn,
    product.part_number,
    product.itemid,
    product.track_size,
    product.tread_pattern,
    product.oem_part_number,
  ];
  const size = normalizeText(product.track_size);
  for (const brand of brands.slice(0, 12)) {
    if (size) boosts.push(`${brand} ${size} rubber track`);
    boosts.push(`${brand} ${normalizeText(product.part_type || "track")}`);
  }
  for (const model of models.slice(0, 24)) {
    boosts.push(`${model.make} ${model.model} tracks`);
    if (size) boosts.push(`${model.make} ${model.model} ${size}`);
  }
  return boosts;
}

async function main() {
  const [shopifyProducts, products, fitments, models] = await Promise.all([
    Promise.resolve(allShopifyProducts()),
    fetchAll(
      "product",
      "id,product_code,sku,mpn,part_number,itemid,handle,title,part_type,track_size,width_mm,pitch_mm,links,guide_type,tread_pattern,oem_part_number,specs,seo,sales,qa,shopify_product_id,shopify_variant_id",
    ),
    fetchAll("fitment", "product_id,model_id,fit_type,notes", "product_id"),
    fetchAll("model", "id,make,model,model_key,machine_type_code,shopify_metaobject_gid", "id"),
  ]);

  const shopifyById = new Map(shopifyProducts.map((product) => [product.id, product]));
  const shopifyByVariantId = new Map();
  const shopifyBySku = new Map();
  for (const product of shopifyProducts) {
    for (const variant of product.variants?.nodes || []) {
      if (variant.id) shopifyByVariantId.set(variant.id, product);
      if (variant.sku) shopifyBySku.set(variant.sku.trim().toUpperCase(), product);
    }
  }

  const modelById = new Map(models.map((model) => [model.id, model]));
  const fitmentsByProduct = new Map();
  for (const fitment of fitments) {
    if (!fitmentsByProduct.has(fitment.product_id)) fitmentsByProduct.set(fitment.product_id, []);
    const model = modelById.get(fitment.model_id);
    if (!model) continue;
    fitmentsByProduct.get(fitment.product_id).push({
      make: normalizeText(model.make),
      model: normalizeText(model.model),
      model_key: model.model_key || "",
      machine_type: model.machine_type_code || "",
      notes: fitment.notes || "",
    });
  }

  const rows = [];
  const skipped = [];
  for (const product of products) {
    const shopifyProduct =
      shopifyById.get(product.shopify_product_id) ||
      shopifyByVariantId.get(product.shopify_variant_id) ||
      shopifyBySku.get(String(product.sku || "").trim().toUpperCase());
    if (!shopifyProduct) {
      skipped.push({ id: product.id, sku: product.sku, handle: product.handle, reason: "no_live_shopify_product" });
      continue;
    }

    const parsed = parseTrackSize(product.track_size);
    const widthMm = firstPresent(product.width_mm, parsed.widthMm);
    const pitchMm = firstPresent(product.pitch_mm, parsed.pitchMm);
    const links = firstPresent(product.links, parsed.links);
    const compatible = fitmentsByProduct.get(product.id) || [];
    const brands = uniq(compatible.map((model) => model.make));
    const machineTypes = uniq(compatible.map((model) => model.machine_type));
    const modelNames = uniq(compatible.map((model) => `${model.make} ${model.model}`));
    const fitmentSummary =
      modelNames.length > 0
        ? `Fits ${modelNames.length} verified models across ${brands.length} makes: ${brands.slice(0, 12).join(", ")}.`
        : "";
    const tracktechData = {
      source: "supabase",
      product_id: product.id,
      product_code: product.product_code || null,
      itemid: product.itemid || null,
      sku: product.sku || null,
      mpn: product.mpn || null,
      part_number: product.part_number || null,
      handle: product.handle || null,
      shopify_product_id: shopifyProduct.id,
      shopify_variant_id: product.shopify_variant_id || null,
      fitment_count: compatible.length,
      generated_at: new Date().toISOString(),
    };
    const fallback = {
      text: fallbackText(product, compatible),
      title: product.title || shopifyProduct.title,
      specs: {
        track_size: product.track_size || null,
        width_mm: widthMm ? Number(widthMm) : null,
        width_in: widthMm ? Number(widthInches(widthMm)) : null,
        pitch_mm: pitchMm ? Number(pitchMm) : null,
        pitch_type: parsed.pitchType || null,
        links: links ? Number(links) : null,
        guide_type: product.guide_type || null,
        tread_pattern: product.tread_pattern || null,
      },
    };

    rows.push({
      Handle: shopifyProduct.handle,
      Command: "MERGE",
      "Metafield: custom.part_type [single_line_text_field]": product.part_type || "",
      "Metafield: custom.machine_types [list.single_line_text_field]": listValue(machineTypes),
      "Metafield: custom.track_size [single_line_text_field]": product.track_size || "",
      "Metafield: custom.track_size_key [single_line_text_field]": parsed.key || "",
      "Metafield: custom.width_mm [number_integer]": integer(widthMm),
      "Metafield: custom.width_in [number_decimal]": decimal(widthInches(widthMm)),
      "Metafield: custom.pitch_mm [number_decimal]": decimal(pitchMm),
      "Metafield: custom.pitch_type [single_line_text_field]": parsed.pitchType || "",
      "Metafield: custom.links [number_integer]": integer(links),
      "Metafield: custom.guide [single_line_text_field]": product.guide_type || "",
      "Metafield: custom.tread_pattern [single_line_text_field]": product.tread_pattern || "",
      "Metafield: custom.oem_part_number [single_line_text_field]": product.oem_part_number || "",
      "Metafield: custom.warranty_months [number_integer]": product.track_size ? "24" : "",
      "Metafield: custom.compatible_model_names [list.single_line_text_field]": listValue(modelNames),
      "Metafield: custom.fitment_summary [multi_line_text_field]": fitmentSummary,
      "Metafield: custom.tracktech_data_api [json]": jsonValue(tracktechData),
      "Metafield: custom.tracktech_data_fallback [json]": jsonValue(fallback),
      "Metafield: shopify--discovery--product_search_boost.queries [list.single_line_text_field]": listValue(
        searchBoosts(product, compatible, brands),
        75,
      ),
    });
  }

  const headers = [
    "Handle",
    "Command",
    "Metafield: custom.part_type [single_line_text_field]",
    "Metafield: custom.machine_types [list.single_line_text_field]",
    "Metafield: custom.track_size [single_line_text_field]",
    "Metafield: custom.track_size_key [single_line_text_field]",
    "Metafield: custom.width_mm [number_integer]",
    "Metafield: custom.width_in [number_decimal]",
    "Metafield: custom.pitch_mm [number_decimal]",
    "Metafield: custom.pitch_type [single_line_text_field]",
    "Metafield: custom.links [number_integer]",
    "Metafield: custom.guide [single_line_text_field]",
    "Metafield: custom.tread_pattern [single_line_text_field]",
    "Metafield: custom.oem_part_number [single_line_text_field]",
    "Metafield: custom.warranty_months [number_integer]",
    "Metafield: custom.compatible_model_names [list.single_line_text_field]",
    "Metafield: custom.fitment_summary [multi_line_text_field]",
    "Metafield: custom.tracktech_data_api [json]",
    "Metafield: custom.tracktech_data_fallback [json]",
    "Metafield: shopify--discovery--product_search_boost.queries [list.single_line_text_field]",
  ];

  writeCsv(OUT, rows, headers);
  const summary = {
    output: OUT,
    rows: rows.length,
    skipped: skipped.length,
    shopify_products: shopifyProducts.length,
    supabase_products: products.length,
    fitments: fitments.length,
    models: models.length,
    rows_with_track_size: rows.filter((row) => row["Metafield: custom.track_size [single_line_text_field]"]).length,
    rows_with_fitment_summary: rows.filter((row) => row["Metafield: custom.fitment_summary [multi_line_text_field]"]).length,
    skipped_sample: skipped.slice(0, 25),
  };
  fs.mkdirSync(path.dirname(SUMMARY_OUT), { recursive: true });
  fs.writeFileSync(SUMMARY_OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
