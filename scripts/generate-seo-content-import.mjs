#!/usr/bin/env node
/**
 * Generate Matrixify Products SEO/content import from Supabase + live Shopify IDs.
 *
 * The goal is not fluffy copy. It is deterministic product SEO that preserves:
 * - H1/product title for humans
 * - SEO title for SERP intent
 * - description/body copy for buyer confidence and AI extraction
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const STORE = valueArg("--store", "tracktech-530.myshopify.com");
const OUT = valueArg("--out", path.resolve("../../outputs/HEAVY_IRON_MATRIXIFY_PRODUCT_SEO_CONTENT.csv"));
const SUMMARY_OUT = valueArg("--summary", path.resolve("../../outputs/HEAVY_IRON_PRODUCT_SEO_CONTENT_SUMMARY.json"));

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
      SHOPIFY_CLI_AGENT_IDS: "s:heavy-iron-theme|r:seo-content|i:codex-desktop",
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
          status
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

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function parseSize(trackSize) {
  const raw = normalize(trackSize);
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)([A-Za-z]*)\s*x\s*(\d+)/i);
  if (!match) return {};
  const widthMm = Number(match[1]);
  return {
    widthMm,
    pitchMm: Number(match[2]),
    pitchType: match[3] || "",
    links: Number(match[4]),
    widthIn: Number.isFinite(widthMm) ? Math.round((widthMm / 25.4) * 10) / 10 : null,
  };
}

function truncate(value, max) {
  const text = normalize(value);
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, "");
}

function uniq(values) {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function seoTitle(product, models) {
  const size = normalize(product.track_size);
  const parsed = parseSize(size);
  const width = parsed.widthIn ? `${Math.round(parsed.widthIn)} Inch` : "";
  const makes = uniq(models.map((m) => m.make));
  const topModels = models.slice(0, 3).map((m) => m.model).filter(Boolean);
  if (size && makes.length === 1 && topModels.length) {
    return truncate(`${makes[0]} ${topModels.join(", ")} Rubber Tracks | ${width} ${size}`, 60);
  }
  if (size) return truncate(`${size} | ${width} Skid Steer Replacement Rubber Tracks`, 60);
  const title = normalize(product.title || product.part_type || "Heavy Equipment Part");
  const sku = normalize(product.sku || product.product_code);
  return truncate(`${title}${sku ? ` | ${sku}` : ""}`, 60);
}

function metaDescription(product, models) {
  const size = normalize(product.track_size);
  const parsed = parseSize(size);
  const width = parsed.widthIn ? `${Math.round(parsed.widthIn)}-inch` : "";
  const modelText = models.slice(0, 3).map((m) => `${m.make} ${m.model}`).join(", ");
  if (size) {
    const fit = modelText ? ` Fits ${modelText}.` : "";
    return truncate(
      `Heavy-duty ${size} replacement rubber tracks for skid steers. ${width ? `Premium ${width} width for traction and long tread life.` : "Built for traction and long tread life."}${fit} In stock and ready to ship.`,
      155,
    );
  }
  return truncate(
    `${normalize(product.title)} for heavy equipment. Supabase-verified fitment data, clean product specs, and fast freight from Heavy Iron Supply Co.`,
    155,
  );
}

function bodyHtml(product, models) {
  const size = normalize(product.track_size);
  const parsed = parseSize(size);
  const title = normalize(product.title || "Heavy Equipment Part");
  if (!size) {
    return `<p>${title} with Heavy Iron Supply Co. catalog-backed product data. Verify fitment before ordering or call with your machine make, model, and serial number.</p>`;
  }
  const makeGroups = new Map();
  for (const m of models) {
    if (!makeGroups.has(m.make)) makeGroups.set(m.make, []);
    makeGroups.get(m.make).push(m.model);
  }
  const fitmentList = [...makeGroups.entries()]
    .slice(0, 6)
    .map(([make, modelList]) => `<li><strong>${make}:</strong> ${uniq(modelList).slice(0, 12).join(", ")}</li>`)
    .join("");
  const tread = normalize(product.tread_pattern) || "jobsite";
  return [
    `<p>Built for the dirt, not the shop. This premium ${parsed.widthIn ? `${Math.round(parsed.widthIn)} inch` : ""} (${size}) replacement rubber track is engineered for compact track loaders and skid steers that need traction, low stretch, and dependable undercarriage engagement.</p>`,
    "<h3>Guaranteed Fitment Data</h3>",
    fitmentList ? `<ul>${fitmentList}</ul>` : "<p>Verify your stamped track size and machine serial number before ordering.</p>",
    "<h3>Track Dimensions</h3>",
    `<ul><li><strong>Size:</strong> ${size}</li><li><strong>Track Width:</strong> ${parsed.widthMm || product.width_mm || ""} mm${parsed.widthIn ? ` (${parsed.widthIn} in)` : ""}</li><li><strong>Pitch:</strong> ${parsed.pitchMm || product.pitch_mm || ""} mm${parsed.pitchType ? ` (${parsed.pitchType} pitch)` : ""}</li><li><strong>Link Count:</strong> ${parsed.links || product.links || ""}</li><li><strong>Tread Style:</strong> ${tread}</li></ul>`,
    "<h3>Why Operators Switch</h3>",
    "<ul><li><strong>Continuous-wound steel cord:</strong> helps eliminate the weak overlapping splice found in cheap tracks.</li><li><strong>Virgin rubber compound:</strong> resists chunking, slicing, dry rot, and jobsite abuse.</li><li><strong>Drop-forged iron cores:</strong> lock into drive sprockets to reduce de-tracking on grades and turns.</li></ul>",
    "<p><strong>Sold individually.</strong> Most machines require quantity 2 for left and right track replacement. Check the stamped numbers on the inside wall of your old track before checkout.</p>",
  ].join("");
}

async function main() {
  const [shopifyProducts, products, fitments, models] = await Promise.all([
    Promise.resolve(allShopifyProducts()),
    fetchAll("product", "id,product_code,sku,handle,title,track_size,width_mm,pitch_mm,links,tread_pattern,part_type,shopify_product_id,shopify_variant_id"),
    fetchAll("fitment", "product_id,model_id,fit_type,is_primary", "product_id"),
    fetchAll("model", "id,make,model,model_key,machine_type_code", "id"),
  ]);

  const shopifyByProductId = new Map(shopifyProducts.map((p) => [p.id, p]));
  const shopifyByVariantId = new Map();
  const shopifyBySku = new Map();
  for (const sp of shopifyProducts) {
    for (const variant of sp.variants?.nodes || []) {
      if (variant.id) shopifyByVariantId.set(variant.id, sp);
      if (variant.sku) shopifyBySku.set(variant.sku.trim().toUpperCase(), sp);
    }
  }
  const modelById = new Map(models.map((m) => [m.id, m]));
  const fitmentsByProduct = new Map();
  for (const f of fitments) {
    const model = modelById.get(f.model_id);
    if (!model) continue;
    if (!fitmentsByProduct.has(f.product_id)) fitmentsByProduct.set(f.product_id, []);
    fitmentsByProduct.get(f.product_id).push(model);
  }

  const rows = [];
  const skipped = [];
  for (const product of products) {
    const shopifyProduct =
      shopifyByProductId.get(product.shopify_product_id) ||
      shopifyByVariantId.get(product.shopify_variant_id) ||
      shopifyBySku.get(String(product.sku || "").trim().toUpperCase());
    if (!shopifyProduct) {
      skipped.push({ id: product.id, sku: product.sku, handle: product.handle });
      continue;
    }
    const modelsForProduct = fitmentsByProduct.get(product.id) || [];
    rows.push({
      Handle: shopifyProduct.handle,
      Command: "MERGE",
      "SEO Title": seoTitle(product, modelsForProduct),
      "SEO Description": metaDescription(product, modelsForProduct),
      "Body HTML": bodyHtml(product, modelsForProduct),
      "Image Alt Text": product.track_size
        ? `Heavy duty ${product.track_size} rubber track replacement${product.tread_pattern ? ` - ${product.tread_pattern} tread` : ""}`
        : `${normalize(product.title)} for heavy equipment`,
    });
  }

  writeCsv(OUT, rows, ["Handle", "Command", "SEO Title", "SEO Description", "Body HTML", "Image Alt Text"]);
  const summary = {
    output: OUT,
    rows: rows.length,
    skipped: skipped.length,
    rows_with_track_size: rows.filter((r) => r["SEO Title"].includes("Rubber Tracks")).length,
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
