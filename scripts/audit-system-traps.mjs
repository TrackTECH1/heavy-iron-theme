#!/usr/bin/env node
/**
 * Audit Shopify catalog traps that break feeds, freight, and agentic shopping.
 *
 * Reads products via Shopify CLI and writes:
 * - system trap audit CSV
 * - Matrixify Products repair CSV for track inventory/weight fields
 *
 * Inventory writes require write_inventory scope, so this script generates a
 * Matrixify repair lane instead of mutating inventory directly.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const STORE = valueArg("--store", "tracktech-530.myshopify.com");
const OUT_DIR = valueArg("--out-dir", path.resolve("../../outputs"));
const AUDIT_OUT = path.join(OUT_DIR, "HEAVY_IRON_SHOPIFY_SYSTEM_TRAPS_AUDIT.csv");
const REPAIR_OUT = path.join(OUT_DIR, "HEAVY_IRON_MATRIXIFY_TRACK_FREIGHT_INVENTORY_REPAIR.csv");
const SUMMARY_OUT = path.join(OUT_DIR, "HEAVY_IRON_SHOPIFY_SYSTEM_TRAPS_SUMMARY.json");

const DEFAULT_TRACK_WEIGHT_LB = Number(valueArg("--track-weight-lb", "430"));
const DEFAULT_TRACK_QTY = Number(valueArg("--track-qty", "999"));

function valueArg(name, fallback) {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function shopifyGql(query, variables = {}) {
  const cmd = ["store", "execute", "--store", STORE, "--query", query, "--json"];
  if (Object.keys(variables).length) cmd.push("--variables", JSON.stringify(variables));
  const stdout = execFileSync("shopify", cmd, {
    encoding: "utf8",
    env: {
      ...process.env,
      SHOPIFY_CLI_AGENT_INFO: "n:codex|v:1|p:openai",
      SHOPIFY_CLI_AGENT_IDS: "s:heavy-iron-theme|r:system-traps|i:codex-desktop",
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

function allProducts() {
  const query = `
    query Products($cursor: String) {
      products(first: 250, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          handle
          title
          status
          productType
          category { id fullName }
          totalInventory
          tracksInventory
          trackSize: metafield(namespace: "custom", key: "track_size") { value }
          variants(first: 100) {
            nodes {
              id
              title
              sku
              price
              inventoryQuantity
              inventoryPolicy
              inventoryItem {
                id
                tracked
                measurement { weight { value unit } }
              }
            }
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

function isTrack(product) {
  const haystack = `${product.productType || ""} ${product.title || ""} ${product.trackSize?.value || ""}`.toLowerCase();
  return haystack.includes("rubber track") || Boolean(product.trackSize?.value);
}

function issueList(product, variant) {
  const issues = [];
  const category = product.category?.fullName || "";
  if (!category || category === "Uncategorized") issues.push("missing_or_uncategorized_category");
  if (!product.tracksInventory || !variant.inventoryItem?.tracked) issues.push("inventory_not_tracked");
  const weight = Number(variant.inventoryItem?.measurement?.weight?.value || 0);
  if (weight <= 0) issues.push("zero_variant_weight");
  if (Number(variant.price || 0) <= 0) issues.push("zero_variant_price");
  if (product.status !== "ACTIVE") issues.push(`product_${String(product.status || "unknown").toLowerCase()}`);
  if (!variant.sku) issues.push("missing_variant_sku");
  return issues;
}

function main() {
  const products = allProducts();
  const auditRows = [];
  const repairRows = [];

  for (const product of products) {
    const productIsTrack = isTrack(product);
    for (const variant of product.variants?.nodes || []) {
      const issues = issueList(product, variant);
      if (issues.length) {
        auditRows.push({
          product_id: product.id,
          handle: product.handle,
          title: product.title,
          status: product.status,
          product_type: product.productType,
          category: product.category?.fullName || "",
          track_size: product.trackSize?.value || "",
          variant_id: variant.id,
          variant_title: variant.title,
          sku: variant.sku || "",
          price: variant.price,
          inventory_tracked: variant.inventoryItem?.tracked ? "true" : "false",
          inventory_quantity: variant.inventoryQuantity,
          weight_value: variant.inventoryItem?.measurement?.weight?.value ?? "",
          weight_unit: variant.inventoryItem?.measurement?.weight?.unit ?? "",
          issues: issues.join("|"),
        });
      }

      if (productIsTrack && (issues.includes("inventory_not_tracked") || issues.includes("zero_variant_weight"))) {
        repairRows.push({
          Handle: product.handle,
          Command: "MERGE",
          "Variant SKU": variant.sku || "",
          "Variant Command": "MERGE",
          "Variant Inventory Tracker": "shopify",
          "Variant Inventory Qty": DEFAULT_TRACK_QTY,
          "Variant Inventory Policy": "deny",
          "Variant Weight": DEFAULT_TRACK_WEIGHT_LB,
          "Variant Weight Unit": "lb",
        });
      }
    }
  }

  writeCsv(AUDIT_OUT, auditRows, [
    "product_id",
    "handle",
    "title",
    "status",
    "product_type",
    "category",
    "track_size",
    "variant_id",
    "variant_title",
    "sku",
    "price",
    "inventory_tracked",
    "inventory_quantity",
    "weight_value",
    "weight_unit",
    "issues",
  ]);
  writeCsv(REPAIR_OUT, repairRows, [
    "Handle",
    "Command",
    "Variant SKU",
    "Variant Command",
    "Variant Inventory Tracker",
    "Variant Inventory Qty",
    "Variant Inventory Policy",
    "Variant Weight",
    "Variant Weight Unit",
  ]);

  const countIssues = (name) => auditRows.filter((row) => row.issues.includes(name)).length;
  const summary = {
    store: STORE,
    products: products.length,
    audit_rows: auditRows.length,
    repair_rows: repairRows.length,
    missing_or_uncategorized_category: countIssues("missing_or_uncategorized_category"),
    inventory_not_tracked: countIssues("inventory_not_tracked"),
    zero_variant_weight: countIssues("zero_variant_weight"),
    zero_variant_price: countIssues("zero_variant_price"),
    product_draft: countIssues("product_draft"),
    product_archived: countIssues("product_archived"),
    missing_variant_sku: countIssues("missing_variant_sku"),
    audit_output: AUDIT_OUT,
    repair_output: REPAIR_OUT,
  };
  fs.writeFileSync(SUMMARY_OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main();
