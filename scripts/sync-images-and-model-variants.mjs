#!/usr/bin/env node
/**
 * Sync Heavy Iron desktop track imagery + model variant references.
 *
 * Dry-run by default.
 *
 * Examples:
 *   node scripts/sync-images-and-model-variants.mjs --limit=25
 *   node scripts/sync-images-and-model-variants.mjs --apply-supabase --limit=25
 *   node scripts/sync-images-and-model-variants.mjs --apply-shopify-media --limit=10
 *   node scripts/sync-images-and-model-variants.mjs --apply-model-metaobjects --limit=10
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--") && !arg.includes("=")));
const argValue = (name, fallback) => {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const APPLY_SUPABASE = args.has("--apply-supabase");
const APPLY_SHOPIFY_MEDIA = args.has("--apply-shopify-media");
const APPLY_MODEL_METAOBJECTS = args.has("--apply-model-metaobjects");
const ALLOW_PARTIAL_MODELS = args.has("--allow-partial-models");
const OVERWRITE_STORAGE = args.has("--overwrite-storage");
const LIMIT = Number(argValue("--limit", "50"));
const STORE = argValue("--store", "tracktech-530.myshopify.com");
const IMAGE_ROOT = argValue(
  "--image-root",
  path.join(os.homedir(), "Desktop/track-images/clean/_flat"),
);
const OUT_DIR = argValue("--out-dir", path.resolve("outputs"));
const BUCKET = argValue("--bucket", "catalog-images");

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

const projectEnvPath = findUp(process.cwd(), ".env.local");

const env = {
  ...loadEnvFile(path.join(os.homedir(), "tracktech-image-upload/.env")),
  ...loadEnvFile(projectEnvPath || ""),
  ...process.env,
};

const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SECRET_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing Supabase URL/key. Expected .env.local or ~/tracktech-image-upload/.env.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

function blank(value) {
  return value == null || String(value).trim() === "";
}

function sizeStrict(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.5/g, "5")
    .replace(/[^a-z0-9]/g, "");
}

function sizeLoose(value) {
  return sizeStrict(value).replace(/(\d{2,4})x?(\d{2,4})([bkmntw])x?(\d{2,4})/, "$1$2$4");
}

function sizeImageKey(value) {
  return sizeStrict(value).replace(/(\d{2,4})x?(\d{2,4})b(x?\d{2,4})/, "$1$2$3");
}

function treadKey(value) {
  const raw = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const aliases = {
    block: "staggered-block",
    "c-block": "staggered-block",
    directional: "staggered-block",
    "staggered-block": "staggered-block",
    zigzag: "zig-zag",
    "zig-zag": "zig-zag",
    z: "z-max",
    zb: "zig-zag",
    "z-max": "z-max",
    "multi-bar": "multi-bar",
    mx: "mx",
    "x-terrain": "x-terrain",
    "all-terrain": "all-terrain",
    "t-bar": "t-bar",
    vortech: "vortech",
    "l-tread": "l-tread",
    "camso-sd": "camso-sd",
  };
  return aliases[raw] || raw;
}

function imageTreadKey(value) {
  const raw = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const aliases = {
    zigzag: "zig-zag",
    "zig-zag": "zig-zag",
    z: "z-max",
    "z-max": "z-max",
    zb: "zig-zag",
    "c-block": "c-block",
    block: "block",
    "staggered-block": "staggered-block",
    directional: "directional",
    "multi-bar": "multi-bar",
    mx: "mx",
    "x-terrain": "x-terrain",
    "all-terrain": "all-terrain",
    "t-bar": "t-bar",
    vortech: "vortech",
    "l-tread": "l-tread",
    "camso-sd": "camso-sd",
  };
  return aliases[raw] || raw;
}

function productTreadCandidates(value) {
  const raw = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (raw === "c-block" || raw === "c") return ["c-block"];
  if (raw === "block") return ["block", "staggered-block"];
  if (raw === "staggered-block") return ["staggered-block", "block"];
  if (raw === "directional") return ["directional"];
  return [imageTreadKey(raw)];
}

function canonicalTreadLabel(value) {
  const key = treadKey(value);
  const labels = {
    "staggered-block": "Staggered-Block",
    "zig-zag": "Zig-Zag",
    "z-max": "Z-Max",
    "multi-bar": "Multi-Bar",
    mx: "MX",
    "x-terrain": "X-Terrain",
    "all-terrain": "All-Terrain",
    "t-bar": "T-Bar",
    vortech: "Vortech",
    "l-tread": "L-Tread",
    "camso-sd": "Camso SD",
  };
  return labels[key] || String(value || "").trim();
}

function storagePathFor(filePath) {
  return path.basename(filePath).replace(/\s+/g, "-");
}

function parseImageFile(filePath) {
  const filename = path.basename(filePath);
  const base = filename.replace(/\.[^.]+$/, "");
  const parts = base.split("-");
  let role = "hero";
  if (/^\d+$/.test(parts.at(-1))) {
    const num = parts.pop();
    role = { "01": "hero", "02": "tread_detail", "03": "alt", "04": "steel_cord" }[num] || `image_${num}`;
  }
  const treadParts = [];
  while (parts.length && !/^\d/.test(parts.at(-1))) treadParts.unshift(parts.pop());
  const trackSize = parts.join("-");
  const tread = treadParts.join("-");
  return {
    file_path: filePath,
    filename,
    track_size: trackSize,
    tread_pattern: canonicalTreadLabel(tread),
    role,
    size_key: trackSize,
    match_key: `${sizeImageKey(trackSize)}|${imageTreadKey(tread)}`,
    storage_bucket: BUCKET,
    storage_path: storagePathFor(filePath),
    public_url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(storagePathFor(filePath)).replace(/%2F/g, "/")}`,
    alt_text: `${trackSize} ${canonicalTreadLabel(tread)} rubber track`,
  };
}

function productMatchKey(product) {
  return `${sizeImageKey(product.track_size)}|${productTreadCandidates(product.tread_pattern)[0]}`;
}

function productMatchKeys(product) {
  return productTreadCandidates(product.tread_pattern).map((tread) => `${sizeImageKey(product.track_size)}|${tread}`);
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeCsv(filePath, rows) {
  if (!rows.length) {
    fs.writeFileSync(filePath, "");
    return;
  }
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  fs.writeFileSync(filePath, csv);
}

function writeMatrixifyProductImages(filePath, rows) {
  const importRows = rows
    .filter((row) => row.action === "would_attach_variant_media" || row.action === "attach_variant_media" || row.action === "already_attached")
    .map((row, index) => ({
      Command: "MERGE",
      Handle: row.shopify_handle || "",
      "Variant SKU": row.sku || "",
      "Image Src": row.public_url || "",
      "Image Position": String(index + 1),
      "Image Alt Text": `${row.track_size} ${row.tread_pattern} rubber track`,
    }))
    .filter((row) => row.Handle && row["Image Src"]);
  writeCsv(filePath, importRows);
}

async function allRows(table, select) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function shopifyGql(query, variables = {}, allowMutations = false) {
  const cmd = ["store", "execute", "--store", STORE, "--query", query, "--json"];
  if (Object.keys(variables).length) cmd.push("--variables", JSON.stringify(variables));
  if (allowMutations) cmd.push("--allow-mutations");
  const stdout = execFileSync("shopify", cmd, {
    encoding: "utf8",
    env: {
      ...process.env,
      SHOPIFY_CLI_AGENT_INFO: "n:codex|v:1|p:openai",
      SHOPIFY_CLI_AGENT_IDS: "s:heavy-iron-theme|r:image-metaobject-sync|i:codex-desktop",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const jsonStart = stdout.indexOf("{");
  return JSON.parse(jsonStart >= 0 ? stdout.slice(jsonStart) : stdout);
}

function normalizeHandle(handle) {
  return String(handle || "")
    .toLowerCase()
    .replace(/bx|kx|nx|tx|wx/g, "x")
    .replace(/(\d+)\.(\d+)/g, "$1-$2");
}

function handleCandidates(product) {
  const out = new Set();
  if (product.handle) out.add(product.handle);
  if (product.handle) out.add(normalizeHandle(product.handle));
  const size = String(product.track_size || "")
    .toLowerCase()
    .replace(/bx|kx|nx|tx|wx/g, "x")
    .replace(/\./g, "-");
  const tread = treadKey(product.tread_pattern);
  if (size && tread) {
    out.add(`${size}-rubber-track-${tread}`);
    out.add(`${size}-rubber-tracks-${tread}`);
  }
  return [...out].filter(Boolean);
}

const productLookupCache = new Map();

function resolveShopifyProduct(product) {
  const cacheKey = product.sku || product.product_code || product.id;
  if (productLookupCache.has(cacheKey)) return productLookupCache.get(cacheKey);

  const query = `
    query ResolveProduct($skuQuery: String!, $handle: String!) {
      bySku: productVariants(first: 3, query: $skuQuery) {
        nodes { id sku title product { id handle title media(first: 20) { nodes { id alt mediaContentType preview { image { url } } } } } }
      }
      byHandle: productByIdentifier(identifier: { handle: $handle }) {
        id handle title
        media(first: 20) { nodes { id alt mediaContentType preview { image { url } } } }
        variants(first: 20) { nodes { id sku title } }
      }
    }`;

  for (const handle of handleCandidates(product)) {
    const data = shopifyGql(query, {
      skuQuery: product.sku ? `sku:${product.sku}` : "sku:__none__",
      handle,
    });
    const skuNode = data.bySku?.nodes?.[0];
    if (skuNode) {
      const hit = {
        product_id: skuNode.product.id,
        product_handle: skuNode.product.handle,
        product_title: skuNode.product.title,
        variant_id: skuNode.id,
        variant_title: skuNode.title,
        media: skuNode.product.media?.nodes || [],
        resolution: "sku",
      };
      productLookupCache.set(cacheKey, hit);
      return hit;
    }
    if (data.byHandle) {
      const variant = (data.byHandle.variants?.nodes || []).find((node) => node.sku === product.sku) ||
        data.byHandle.variants?.nodes?.[0];
      const hit = {
        product_id: data.byHandle.id,
        product_handle: data.byHandle.handle,
        product_title: data.byHandle.title,
        variant_id: variant?.id || null,
        variant_title: variant?.title || "",
        media: data.byHandle.media?.nodes || [],
        resolution: "handle",
      };
      productLookupCache.set(cacheKey, hit);
      return hit;
    }
  }

  const miss = null;
  productLookupCache.set(cacheKey, miss);
  return miss;
}

async function uploadSupabaseImage(image) {
  if (!APPLY_SUPABASE) return "dry-run";
  const body = fs.readFileSync(image.file_path);
  const { error } = await supabase.storage
    .from(image.storage_bucket)
    .upload(image.storage_path, body, {
      contentType: "image/webp",
      upsert: OVERWRITE_STORAGE,
    });
  if (error) {
    const message = String(error.message || error).toLowerCase();
    if (message.includes("duplicate") || message.includes("already")) return "exists";
    throw error;
  }
  return "uploaded";
}

async function upsertCatalogImage(image, itemid = null) {
  if (!APPLY_SUPABASE) return "dry-run";
  const row = {
    track_size: image.track_size,
    tread_pattern: image.tread_pattern,
    role: image.role,
    storage_bucket: image.storage_bucket,
    storage_path: image.storage_path,
    alt_text: image.alt_text,
    size_key: image.size_key,
    match_key: image.match_key,
    itemid,
  };
  await supabase
    .from("catalog_images")
    .delete()
    .eq("track_size", row.track_size)
    .eq("tread_pattern", row.tread_pattern)
    .eq("role", row.role)
    .eq("storage_path", row.storage_path);
  const { error } = await supabase.from("catalog_images").insert(row);
  if (error) throw error;
  return "inserted";
}

function mediaAlreadyAttached(media, image) {
  return (media || []).some((node) => {
    const url = node.preview?.image?.url || "";
    return url.includes(image.storage_path) || url.includes(image.filename);
  });
}

function attachVariantMedia(shopifyProduct, image) {
  if (!APPLY_SHOPIFY_MEDIA) return { status: "dry-run" };
  const mutation = `
    mutation AttachVariantMedia($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: true) {
        product { id }
        productVariants { id }
        userErrors { field message }
      }
    }`;
  const data = shopifyGql(
    mutation,
    {
      productId: shopifyProduct.product_id,
      variants: [{ id: shopifyProduct.variant_id, mediaSrc: [image.public_url] }],
    },
    true,
  );
  const errors = data.productVariantsBulkUpdate?.userErrors || [];
  if (errors.length) return { status: "error", error: JSON.stringify(errors) };
  return { status: "attached" };
}

function updateModelTrackVariants(modelGid, variantIds) {
  if (!APPLY_MODEL_METAOBJECTS) return { status: "dry-run" };
  const mutation = `
    mutation UpdateModelTrackVariants($id: ID!, $fields: [MetaobjectFieldInput!]!) {
      metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
        metaobject { id handle }
        userErrors { field message code }
      }
    }`;
  const data = shopifyGql(
    mutation,
    {
      id: modelGid,
      fields: [{ key: "track_variants", value: JSON.stringify([...new Set(variantIds)]) }],
    },
    true,
  );
  const errors = data.metaobjectUpdate?.userErrors || [];
  if (errors.length) return { status: "error", error: JSON.stringify(errors) };
  return { status: "updated" };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const imageFiles = fs
    .readdirSync(IMAGE_ROOT)
    .filter((file) => /\.(webp|jpe?g|png|avif)$/i.test(file))
    .map((file) => parseImageFile(path.join(IMAGE_ROOT, file)));
  const heroImagesByKey = new Map();
  for (const image of imageFiles) {
    if (image.role !== "hero") continue;
    if (!heroImagesByKey.has(image.match_key)) heroImagesByKey.set(image.match_key, image);
  }

  const [products, models, fitments] = await Promise.all([
    allRows("product", "id,sku,product_code,itemid,title,type,part_type,track_size,tread_pattern,image_url,image_alt,shopify_product_id,shopify_variant_id,handle"),
    allRows("model", "id,model_key,make,model,shopify_metaobject_gid"),
    allRows("fitment", "id,model_id,product_id,fit_type,is_primary,position"),
  ]);

  const trackProducts = products.filter((product) =>
    String(product.part_type || "").toLowerCase().includes("rubber track") ||
    String(product.type || "").toLowerCase().includes("track") ||
    !blank(product.track_size)
  );
  const modelById = new Map(models.map((model) => [model.id, model]));
  const productById = new Map(products.map((product) => [product.id, product]));

  const exactImageRows = trackProducts
    .map((product) => {
      const image = productMatchKeys(product).map((key) => heroImagesByKey.get(key)).find(Boolean) || null;
      return { product, image };
    })
    .filter((row) => row.image)
    .slice(0, LIMIT);

  const mediaRows = [];
  for (const { product, image } of exactImageRows) {
    const shopifyProduct = resolveShopifyProduct(product);
    const row = {
      sku: product.sku || "",
      product_code: product.product_code || "",
      title: product.title || "",
      track_size: product.track_size || "",
      tread_pattern: product.tread_pattern || "",
      storage_path: image.storage_path,
      public_url: image.public_url,
      shopify_product_id: shopifyProduct?.product_id || "",
      shopify_variant_id: shopifyProduct?.variant_id || "",
      shopify_handle: shopifyProduct?.product_handle || "",
      resolution: shopifyProduct?.resolution || "missing",
      action: "unresolved",
      result: "",
    };
    try {
      await uploadSupabaseImage(image);
      await upsertCatalogImage(image, product.itemid || null);
      if (!shopifyProduct?.product_id || !shopifyProduct?.variant_id) {
        row.action = "review_no_shopify_match";
      } else if (mediaAlreadyAttached(shopifyProduct.media, image)) {
        row.action = "already_attached";
      } else {
        row.action = APPLY_SHOPIFY_MEDIA ? "attach_variant_media" : "would_attach_variant_media";
        row.result = attachVariantMedia(shopifyProduct, image).status;
      }
    } catch (error) {
      row.action = "error";
      row.result = error.message || String(error);
    }
    mediaRows.push(row);
  }

  const trackFitments = fitments.filter((fitment) => fitment.fit_type === "track");
  const modelGroups = new Map();
  for (const fitment of trackFitments) {
    const model = modelById.get(fitment.model_id);
    const product = productById.get(fitment.product_id);
    if (!model?.shopify_metaobject_gid || !product) continue;
    if (!modelGroups.has(model.id)) modelGroups.set(model.id, { model, products: [] });
    modelGroups.get(model.id).products.push(product);
  }

  const modelRows = [];
  for (const { model, products: modelProducts } of [...modelGroups.values()].slice(0, LIMIT)) {
    const variantIds = [];
    const unresolved = [];
    for (const product of modelProducts) {
      const shopifyProduct = resolveShopifyProduct(product);
      if (shopifyProduct?.variant_id) variantIds.push(shopifyProduct.variant_id);
      else unresolved.push(product.sku || product.product_code || product.id);
    }
    const uniqueVariantIds = [...new Set(variantIds)];
    let result = "dry-run";
    let action = APPLY_MODEL_METAOBJECTS ? "update_track_variants" : "would_update_track_variants";
    if (unresolved.length && !ALLOW_PARTIAL_MODELS) {
      action = "review_partial_model_unresolved_products";
      result = "skipped";
    } else if (uniqueVariantIds.length) {
      result = updateModelTrackVariants(model.shopify_metaobject_gid, uniqueVariantIds).status;
    }
    modelRows.push({
      model_key: model.model_key,
      make: model.make,
      model: model.model,
      shopify_metaobject_gid: model.shopify_metaobject_gid,
      variant_count: uniqueVariantIds.length,
      unresolved_count: unresolved.length,
      unresolved: unresolved.slice(0, 12).join(" | "),
      action,
      result,
    });
  }

  writeCsv(path.join(OUT_DIR, "HEAVY_IRON_SHOPIFY_MEDIA_SYNC_PLAN.csv"), mediaRows);
  writeCsv(path.join(OUT_DIR, "HEAVY_IRON_MODEL_TRACK_VARIANTS_SYNC_PLAN.csv"), modelRows);
  writeMatrixifyProductImages(path.join(OUT_DIR, "HEAVY_IRON_MATRIXIFY_PRODUCT_IMAGES.csv"), mediaRows);

  const summary = {
    mode: {
      apply_supabase: APPLY_SUPABASE,
      apply_shopify_media: APPLY_SHOPIFY_MEDIA,
      apply_model_metaobjects: APPLY_MODEL_METAOBJECTS,
      allow_partial_models: ALLOW_PARTIAL_MODELS,
      limit: LIMIT,
      store: STORE,
    },
    desktop_images: imageFiles.length,
    hero_images_with_match_key: heroImagesByKey.size,
    track_products: trackProducts.length,
    exact_image_products_in_this_run: exactImageRows.length,
    media_actions: mediaRows.reduce((memo, row) => {
      memo[row.action] = (memo[row.action] || 0) + 1;
      return memo;
    }, {}),
    model_rows_in_this_run: modelRows.length,
    model_variant_refs_in_this_run: modelRows.reduce((sum, row) => sum + Number(row.variant_count || 0), 0),
  };

  fs.writeFileSync(
    path.join(OUT_DIR, "HEAVY_IRON_IMAGE_METAOBJECT_SYNC_SUMMARY.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
