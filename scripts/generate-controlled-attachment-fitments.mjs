#!/usr/bin/env node
/**
 * Generate controlled machine -> attachment recommendations from Supabase data.
 *
 * This does not claim OEM pin-on fitment. It creates a conservative recommendation
 * layer by machine class, mount family, operating weight, hydraulic flow, and
 * attachment category. Use the full CSV for Supabase review/import and the
 * featured CSV for Shopify/Matrixify model featured_attachments planning.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const argValue = (name, fallback) => {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const OUT_DIR = argValue("--out-dir", path.resolve("outputs"));
const MAX_MODELS = Number(argValue("--max-models", "0"));
const FEATURED_LIMIT = Number(argValue("--featured-limit", "8"));

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
const env = {
  ...loadEnvFile(path.join(os.homedir(), "tracktech-image-upload/.env")),
  ...loadEnvFile(envPath || ""),
  ...process.env,
};
const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL and service/secret key.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

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

function textBlob(item) {
  return `${item.title || ""} ${item.handle || ""} ${item.sku || ""} ${item.attachment_category || ""}`.toLowerCase();
}

function isAttachment(product) {
  return String(product.type || "").toLowerCase() === "attachment" ||
    /bucket|grapple|brush cutter|auger|fork|attachment|blade|rake|mulcher|stump|trencher|broom|backhoe|mower|sweeper|breaker|hammer|snow|pallet|tree|concrete/.test(textBlob(product));
}

function inferAttachmentCategory(product) {
  const s = textBlob(product);
  if (/brush cutter|mulching|mower|tree reaper|rotary cutter/.test(s)) return "brush_cutter";
  if (/mulcher|forestry/.test(s)) return "mulcher";
  if (/grapple/.test(s)) return "grapple";
  if (/fork|pallet/.test(s)) return "forks";
  if (/auger|bit hex|bit round|tree bit/.test(s)) return "auger";
  if (/trencher|trench/.test(s)) return "trencher";
  if (/broom|sweeper|power rake/.test(s)) return "broom";
  if (/snow|plow|litter/.test(s)) return "snow";
  if (/blade|dozer|scrape|ripper/.test(s)) return "blade";
  if (/breaker|hammer/.test(s)) return "breaker";
  if (/bucket|4-n-1|4n1|concrete/.test(s)) return "bucket";
  return product.attachment_category || "other";
}

function inferMount(product) {
  const s = textBlob(product);
  if (/excavator|backhoe|kx161|bobcat single pin|<\s?\d{1,2},?000 lbs|exb\d+k|pin/.test(s)) return "excavator_pin_on";
  if (/dingo|mt50|mt52|mt55|mini skid|mini loader|miniadh|back-dingo|ramrod|boxer/.test(s)) return "mini_skid_steer";
  if (/compact tractor|tractor bucket|class i|sub-compact|ct[a-z]/.test(s)) return "compact_tractor";
  if (/skid steer|track loader|universal skid|x-treme|cid|hd |heavy duty|industrial track loader|root grapple|rock bucket|pallet fork/.test(s)) return "universal_skid_steer";
  return "universal_skid_steer";
}

function flowRequirement(product) {
  const s = textBlob(product);
  const match = s.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*gpm/) || s.match(/(\d{1,2})\s*gpm/);
  if (match && match[2]) return { min: Number(match[1]), max: Number(match[2]), source: "title_gpm_range" };
  if (match) return { min: Number(match[1]), max: 99, source: "title_gpm_min" };
  const category = inferAttachmentCategory(product);
  if (category === "brush_cutter") return { min: 14, max: 99, source: "category_default" };
  if (category === "mulcher") return { min: 27, max: 99, source: "category_default" };
  if (category === "trencher" || category === "auger" || category === "broom") return { min: 8, max: 99, source: "category_default" };
  return { min: 0, max: 99, source: "not_hydraulic_or_unknown" };
}

function modelClass(model) {
  if (model.machine_type_code) return model.machine_type_code;
  const key = `${model.make || ""} ${model.model || ""} ${model.model_key || ""}`.toLowerCase();
  if (/t\d{3}|rt\d{2}|ctl|track loader|compact track/.test(key)) return "compact_track_loader";
  if (/mt\d{2}|tx\d{3,4}|sk\s?\d{3}|ctx|mini track/.test(key)) return "mini_track_loader";
  if (/pc|kx|u-|vio|tb|cx|ec|ecr|ex|zts|mini excavator/.test(key)) return "mini_excavator";
  return "unknown";
}

function modelMount(model) {
  const klass = modelClass(model);
  if (klass === "mini_excavator") return "excavator_pin_on";
  if (klass === "mini_track_loader" || klass === "compact_utility_loader") return "mini_skid_steer";
  if (klass === "compact_track_loader") return "universal_skid_steer";
  return "unknown";
}

function widthScore(model, product) {
  const title = textBlob(product);
  const widths = [...title.matchAll(/(\d{2,3})[”"']/g)].map((match) => Number(match[1]));
  const width = widths.find((value) => value >= 36 && value <= 102);
  if (!width) return { points: 0, note: "no_width" };
  const weight = Number(model.operating_weight_lb || 0);
  const roc = Number(model.rated_operating_capacity_lb || 0);
  let ideal = 72;
  if (weight && weight < 3500) ideal = 44;
  else if (weight && weight < 7000) ideal = 60;
  else if (weight && weight < 9500) ideal = 72;
  else if (weight) ideal = 78;
  else if (roc && roc < 1500) ideal = 60;
  else if (roc && roc > 2500) ideal = 78;
  const diff = Math.abs(width - ideal);
  if (diff <= 6) return { points: 15, note: `width_${width}_near_${ideal}` };
  if (diff <= 12) return { points: 7, note: `width_${width}_ok_${ideal}` };
  return { points: -8, note: `width_${width}_far_${ideal}` };
}

function attachmentWeightOk(model, product) {
  const attachmentWeight = Number(product.weight_lbs || 0);
  if (!attachmentWeight) return { ok: true, points: 0, note: "missing_attachment_weight" };
  const operating = Number(model.operating_weight_lb || 0);
  const roc = Number(model.rated_operating_capacity_lb || 0);
  if (roc) {
    const max = Math.max(500, roc * 0.75);
    return attachmentWeight <= max
      ? { ok: true, points: 8, note: `attachment_weight_${attachmentWeight}_lte_roc_rule_${Math.round(max)}` }
      : { ok: false, points: -100, note: `attachment_weight_${attachmentWeight}_gt_roc_rule_${Math.round(max)}` };
  }
  if (operating) {
    const max = Math.max(350, operating * 0.18);
    return attachmentWeight <= max
      ? { ok: true, points: 5, note: `attachment_weight_${attachmentWeight}_lte_operating_rule_${Math.round(max)}` }
      : { ok: false, points: -100, note: `attachment_weight_${attachmentWeight}_gt_operating_rule_${Math.round(max)}` };
  }
  return { ok: true, points: 0, note: "missing_machine_weight" };
}

function categoryAllowed(machineClass, category) {
  const common = new Set(["bucket", "forks", "auger", "blade", "snow", "broom"]);
  if (machineClass === "compact_track_loader") {
    return common.has(category) || ["grapple", "brush_cutter", "trencher", "breaker", "mulcher", "rake", "other"].includes(category);
  }
  if (machineClass === "mini_track_loader" || machineClass === "compact_utility_loader") {
    return ["bucket", "forks", "auger", "blade", "snow", "broom", "trencher", "grapple", "rake"].includes(category);
  }
  if (machineClass === "mini_excavator") {
    return ["bucket", "auger", "breaker", "brush_cutter", "rake", "other"].includes(category);
  }
  return false;
}

function scorePair(model, product) {
  const category = inferAttachmentCategory(product);
  const mClass = modelClass(model);
  const mMount = modelMount(model);
  const pMount = inferMount(product);
  if (!model.shopify_metaobject_gid) return null;
  if (!categoryAllowed(mClass, category)) return null;
  if (mMount !== "unknown" && pMount !== mMount) {
    if (!(mMount === "universal_skid_steer" && pMount === "compact_tractor")) return null;
  }

  const flow = flowRequirement(product);
  const modelFlow = Number(model.high_flow_gpm || model.hydraulic_flow_gpm || 0);
  if (flow.min && modelFlow && modelFlow < flow.min) return null;
  if (category === "mulcher" && (!model.high_flow_gpm || Number(model.high_flow_gpm) < 27)) return null;

  const weight = attachmentWeightOk(model, product);
  if (!weight.ok) return null;

  let score = 50 + weight.points;
  const notes = [mClass, mMount, pMount, category, flow.source, weight.note];
  if (product.shopify_product_id) score += 30;
  if (product.shopify_variant_id) score += 5;
  if (product.status === "active") score += 5;
  if (category === "bucket") {
    const ws = widthScore(model, product);
    score += ws.points;
    notes.push(ws.note);
  }
  if (flow.min && modelFlow) {
    score += modelFlow >= flow.min ? 8 : 0;
    notes.push(`flow_${modelFlow}_gpm_req_${flow.min}`);
  }
  if (mClass === "mini_excavator" && category === "bucket") score += 12;
  if (mClass === "compact_track_loader" && ["bucket", "grapple", "forks", "brush_cutter"].includes(category)) score += 10;
  if (mClass === "mini_track_loader" && ["bucket", "forks", "auger"].includes(category)) score += 10;

  let confidence = "review";
  if (score >= 90 && product.shopify_product_id) confidence = "featured";
  else if (score >= 72) confidence = "recommended";

  return {
    score,
    confidence,
    category,
    machine_class: mClass,
    model_mount: mMount,
    product_mount: pMount,
    flow_min_gpm: flow.min,
    flow_max_gpm: flow.max,
    notes: notes.join(" | "),
  };
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
  fs.writeFileSync(
    filePath,
    [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n"),
  );
}

function buildRows(models, attachments) {
  const rows = [];
  const usableModels = models
    .filter((model) => model.shopify_metaobject_gid && modelMount(model) !== "unknown")
    .slice(0, MAX_MODELS || undefined);
  for (const model of usableModels) {
    const scored = [];
    for (const product of attachments) {
      const score = scorePair(model, product);
      if (!score) continue;
      scored.push({ model, product, ...score });
    }
    const byCategory = new Map();
    for (const item of scored.sort((a, b) => b.score - a.score)) {
      const bucket = byCategory.get(item.category) || [];
      if (bucket.length >= 5) continue;
      bucket.push(item);
      byCategory.set(item.category, bucket);
    }
    for (const items of byCategory.values()) rows.push(...items);
  }
  return rows;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const [models, products] = await Promise.all([
    allRows("model", "id,model_key,make,model,machine_type_code,operating_weight_lb,horsepower_hp,rated_operating_capacity_lb,hydraulic_flow_gpm,high_flow_gpm,shopify_metaobject_gid"),
    allRows("product", "id,sku,handle,title,type,part_type,attachment_category,weight_lbs,price,status,shopify_product_id,shopify_variant_id"),
  ]);
  const attachments = products.filter(isAttachment);
  const rows = buildRows(models, attachments);

  const fullRows = rows.map((row) => ({
    model_id: row.model.id,
    model_key: row.model.model_key,
    make: row.model.make,
    model: row.model.model,
    machine_class: row.machine_class,
    operating_weight_lb: row.model.operating_weight_lb || "",
    rated_operating_capacity_lb: row.model.rated_operating_capacity_lb || "",
    hydraulic_flow_gpm: row.model.hydraulic_flow_gpm || "",
    high_flow_gpm: row.model.high_flow_gpm || "",
    product_id: row.product.id,
    sku: row.product.sku || "",
    handle: row.product.handle || "",
    title: row.product.title || "",
    category: row.category,
    model_mount: row.model_mount,
    product_mount: row.product_mount,
    flow_min_gpm: row.flow_min_gpm,
    attachment_weight_lbs: row.product.weight_lbs || "",
    shopify_product_id: row.product.shopify_product_id || "",
    shopify_variant_id: row.product.shopify_variant_id || "",
    confidence: row.confidence,
    score: row.score,
    source: "controlled_attachment_rule_v1",
    notes: row.notes,
  }));

  const featuredRows = [];
  for (const model of models) {
    const candidates = rows
      .filter((row) => row.model.id === model.id && row.product.shopify_product_id)
      .sort((a, b) => b.score - a.score);
    const seenProducts = new Set();
    const seenCategories = new Set();
    const featured = [];
    for (const item of candidates) {
      if (seenProducts.has(item.product.shopify_product_id)) continue;
      if (seenCategories.has(item.category) && featured.length < 4) continue;
      seenProducts.add(item.product.shopify_product_id);
      seenCategories.add(item.category);
      featured.push(item);
      if (featured.length >= FEATURED_LIMIT) break;
    }
    if (!featured.length) continue;
    featuredRows.push({
      model_key: model.model_key,
      make: model.make,
      model: model.model,
      shopify_metaobject_gid: model.shopify_metaobject_gid,
      featured_attachment_product_gids: JSON.stringify(featured.map((row) => row.product.shopify_product_id)),
      featured_attachment_skus: featured.map((row) => row.product.sku || row.product.handle).join(" | "),
      categories: [...new Set(featured.map((row) => row.category))].join(" | "),
      max_score: Math.max(...featured.map((row) => row.score)),
      source: "controlled_attachment_rule_v1",
    });
  }

  const matrixifyRows = featuredRows.map((row) => ({
    Command: "MERGE",
    Type: "model",
    Handle: row.model_key,
    "Field: featured_attachments [list.product_reference]": row.featured_attachment_product_gids,
    "Metafield: custom.featured_attachments [list.product_reference]": row.featured_attachment_product_gids,
    Tags: row.categories,
  }));

  writeCsv(path.join(OUT_DIR, "HEAVY_IRON_ATTACHMENT_MODEL_PRODUCT_MAPPING.csv"), fullRows);
  writeCsv(path.join(OUT_DIR, "HEAVY_IRON_MODEL_FEATURED_ATTACHMENTS_PLAN.csv"), featuredRows);
  writeCsv(path.join(OUT_DIR, "HEAVY_IRON_MATRIXIFY_MODEL_FEATURED_ATTACHMENTS.csv"), matrixifyRows);

  const summary = {
    models_total: models.length,
    models_with_shopify_metaobject: models.filter((model) => model.shopify_metaobject_gid).length,
    attachments_total: attachments.length,
    attachments_with_shopify_product: attachments.filter((product) => product.shopify_product_id).length,
    mapping_rows: fullRows.length,
    featured_model_rows: featuredRows.length,
    matrixify_rows: matrixifyRows.length,
    by_confidence: fullRows.reduce((memo, row) => {
      memo[row.confidence] = (memo[row.confidence] || 0) + 1;
      return memo;
    }, {}),
    by_category: fullRows.reduce((memo, row) => {
      memo[row.category] = (memo[row.category] || 0) + 1;
      return memo;
    }, {}),
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "HEAVY_IRON_ATTACHMENT_MAPPING_SUMMARY.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
