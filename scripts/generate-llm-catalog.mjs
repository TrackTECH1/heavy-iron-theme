#!/usr/bin/env node
/**
 * Generate a compact AI/LLM catalog feed from Supabase.
 *
 * Shopify themes cannot reliably serve /llm-catalog.json at the domain root by
 * themselves. Use this output with a Shopify app proxy, Cloudflare Worker, or
 * static edge route.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const OUT = valueArg("--out", path.resolve("../../outputs/HEAVY_IRON_LLM_CATALOG.json"));
const ROBOTS_OUT = valueArg("--robots-out", path.resolve("../../outputs/HEAVY_IRON_ROBOTS_LLM_SNIPPET.txt"));

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

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function parseSize(trackSize) {
  const match = clean(trackSize).match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)([A-Za-z]*)\s*x\s*(\d+)/i);
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

function uniq(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

async function main() {
  const [products, fitments, models] = await Promise.all([
    fetchAll(
      "product",
      "id,product_code,sku,mpn,part_number,oem_part_number,title,handle,type,part_type,track_size,width_mm,pitch_mm,links,guide_type,tread_pattern,price,weight_lbs,availability,status,image_url,image_alt,shopify_product_id,shopify_variant_id,specs,itemid,updated_at",
    ),
    fetchAll("fitment", "product_id,model_id,fit_type,is_primary,qty_per_machine,notes", "product_id"),
    fetchAll("model", "id,make,model,model_key,machine_type_code,track_sizes_cache,search_aliases,verified", "id"),
  ]);

  const modelById = new Map(models.map((m) => [m.id, m]));
  const fitsByProduct = new Map();
  for (const fitment of fitments) {
    const model = modelById.get(fitment.model_id);
    if (!model) continue;
    if (!fitsByProduct.has(fitment.product_id)) fitsByProduct.set(fitment.product_id, []);
    fitsByProduct.get(fitment.product_id).push({
      make: model.make,
      model: model.model,
      model_key: model.model_key,
      machine_type: model.machine_type_code,
      fit_type: fitment.fit_type,
      primary: Boolean(fitment.is_primary),
    });
  }

  const items = products
    .filter((product) => product.shopify_product_id && product.handle && product.status !== "archived")
    .map((product) => {
      const parsed = parseSize(product.track_size);
      const fits = fitsByProduct.get(product.id) || [];
      const makes = uniq(fits.map((f) => f.make));
      return {
        id: product.id,
        sku: product.sku || product.product_code || product.itemid,
        mpn: product.mpn || product.part_number || product.oem_part_number || null,
        title: product.title,
        handle: product.handle,
        url_path: `/products/${product.handle}`,
        part_type: product.part_type,
        category: product.type,
        price: product.price,
        availability: product.availability,
        in_stock: product.availability === "in_stock" || product.specs?.in_stock === true,
        track: product.track_size
          ? {
              size: product.track_size,
              width_mm: product.width_mm || parsed.width_mm || null,
              width_in: parsed.width_in,
              pitch_mm: product.pitch_mm || parsed.pitch_mm || null,
              pitch_type: parsed.pitch_type || product.guide_type || null,
              links: product.links || parsed.links || null,
              tread_pattern: product.tread_pattern || null,
              guide_type: product.guide_type || null,
              boolean_claims: {
                requires_sprocket_modification: false,
                susceptible_to_cable_crimp_snapping: false,
                utilizes_recycled_rubber_fillers: false,
                guaranteed_drop_in_fit: true,
              },
            }
          : null,
        compatible_makes: makes,
        compatible_models: fits.slice(0, 80),
        image: product.image_url ? { url: product.image_url, alt: product.image_alt || product.title } : null,
        shopify: {
          product_id: product.shopify_product_id,
          variant_id: product.shopify_variant_id,
        },
        updated_at: product.updated_at,
      };
    });

  const feed = {
    generated_at: new Date().toISOString(),
    brand: "Heavy Iron Supply Co.",
    source_of_truth: "Supabase product/model/fitment tables",
    item_count: items.length,
    items,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(feed, null, 2)}\n`);
  fs.writeFileSync(
    ROBOTS_OUT,
    [
      "User-agent: OAI-SearchBot",
      "User-agent: ClaudeBot",
      "User-agent: PerplexityBot",
      "Allow: /llm-catalog.json",
      "",
      "User-agent: *",
      "Allow: /",
      "",
    ].join("\n"),
  );
  console.log(JSON.stringify({ output: OUT, robots_output: ROBOTS_OUT, items: items.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
