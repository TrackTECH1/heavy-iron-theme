#!/usr/bin/env node
/**
 * Repair Supabase product.shopify_product_id/shopify_variant_id from the live Shopify catalog.
 *
 * Matching is intentionally conservative:
 *   1. Exact SKU -> Shopify variant/product
 *   2. Exact handle -> Shopify product, with single variant fallback
 *
 * Dry-run by default. Use --apply to write Supabase.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const STORE = valueArg("--store", "tracktech-530.myshopify.com");

function valueArg(name, fallback) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
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
const env = { ...loadEnvFile(envPath || ""), ...process.env };
const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
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
      SHOPIFY_CLI_AGENT_IDS: "s:heavy-iron-theme|r:identity-repair|i:codex-desktop",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const jsonStart = stdout.indexOf("{");
  return JSON.parse(jsonStart >= 0 ? stdout.slice(jsonStart) : stdout);
}

async function allSupabaseProducts() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("product")
      .select("id,sku,handle,shopify_product_id,shopify_variant_id")
      .range(from, from + 999);
    if (error) throw error;
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

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

async function main() {
  const [supabaseProducts, shopifyProducts] = await Promise.all([
    allSupabaseProducts(),
    Promise.resolve(allShopifyProducts()),
  ]);

  const bySku = new Map();
  const byHandle = new Map();
  for (const product of shopifyProducts) {
    byHandle.set(product.handle, product);
    for (const variant of product.variants?.nodes || []) {
      const sku = normalizeSku(variant.sku);
      if (!sku || bySku.has(sku)) continue;
      bySku.set(sku, { product, variant });
    }
  }

  const changes = [];
  const misses = [];
  for (const row of supabaseProducts) {
    const skuHit = bySku.get(normalizeSku(row.sku));
    const handleHit = !skuHit && row.handle ? byHandle.get(row.handle) : null;
    const product = skuHit?.product || handleHit || null;
    const variant = skuHit?.variant || (handleHit?.variants?.nodes?.length === 1 ? handleHit.variants.nodes[0] : null);
    if (!product) {
      misses.push(row);
      continue;
    }
    const patch = {};
    if (row.shopify_product_id !== product.id) patch.shopify_product_id = product.id;
    if (variant?.id && row.shopify_variant_id !== variant.id) patch.shopify_variant_id = variant.id;
    if (!Object.keys(patch).length) continue;
    changes.push({
      id: row.id,
      sku: row.sku || "",
      handle: row.handle || "",
      method: skuHit ? "sku" : "handle",
      patch,
    });
  }

  if (APPLY) {
    for (const change of changes) {
      const { error } = await supabase.from("product").update(change.patch).eq("id", change.id);
      if (error) throw new Error(`${change.handle || change.sku}: ${error.message}`);
    }
  }

  const summary = {
    mode: APPLY ? "apply" : "dry-run",
    shopify_products: shopifyProducts.length,
    shopify_skus: bySku.size,
    supabase_products: supabaseProducts.length,
    would_update_or_updated: changes.length,
    misses: misses.length,
    by_method: changes.reduce((memo, row) => {
      memo[row.method] = (memo[row.method] || 0) + 1;
      return memo;
    }, {}),
    sample_changes: changes.slice(0, 20),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
