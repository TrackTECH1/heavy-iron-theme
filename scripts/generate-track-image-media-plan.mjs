#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  if (!process.argv[i].startsWith("--")) continue;
  args.set(process.argv[i].slice(2), process.argv[i + 1] || "");
  i += 1;
}

const imagesRoot = args.get("images-root") || "/Users/brittonchadbourne/Desktop/track-images/sizes";
const productsCsv = args.get("products-csv") || "";
const outDir = args.get("out-dir") || "work/image-media-plan";
const publicUrlBase = (args.get("public-url-base") || "").replace(/\/$/, "");

if (!productsCsv) {
  console.error("Missing --products-csv path.");
  process.exit(1);
}

const roleBySequence = {
  "01": { role: "hero", position: 1, suffix: "hero product view" },
  "02": { role: "close_up", position: 2, suffix: "tread close-up" },
  "03": { role: "left_side", position: 3, suffix: "left side profile" },
  "04": { role: "steel_cord", position: 4, suffix: "steel cord construction" },
};

const treadAliases = [
  ["staggered-block", ["staggered block", "staggered-block"]],
  ["all-terrain", ["all terrain", "all-terrain"]],
  ["x-terrain", ["x terrain", "x-terrain"]],
  ["offset-block", ["offset block", "offset-block"]],
  ["multi-bar", ["multi bar", "multi-bar", "multibar"]],
  ["directional", ["directional", "dr pattern", "wave", "l tread", "l-tread"]],
  ["c-block", ["c block", "c-block", "c pattern"]],
  ["zig-zag", ["zig zag", "zig-zag"]],
  ["z-max", ["z max", "z-max", "zb"]],
  ["block", ["block"]],
  ["bar", ["bar"]],
  ["mx", ["mx"]],
];

const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

function csvParse(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift() || [];
  return rows
    .filter((r) => r.some(Boolean))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] || ""])));
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file, rows, headers) {
  fs.writeFileSync(
    file,
    [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\n") + "\n",
  );
}

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) out.push(...walk(p));
    else if (imageExts.has(path.extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function textBlob(row) {
  return [
    row.handle,
    row.Handle,
    row.sku,
    row.SKU,
    row["Variant SKU"],
    row.title,
    row.Title,
    row["Product Title"],
  ].filter(Boolean).join(" ").toLowerCase();
}

function productHandle(row) {
  return row.handle || row.Handle || row["Product Handle"] || "";
}

function productSku(row) {
  return row.sku || row.SKU || row["Variant SKU"] || "";
}

function productTitle(row) {
  return row.title || row.Title || row["Product Title"] || "";
}

function productTrackSize(row) {
  return row.track_size || row["Track Size"] || row["Metafield: custom.track_size [single_line_text_field]"] || "";
}

function productTreadPattern(row) {
  return row.tread_pattern || row["Tread Pattern"] || row["Metafield: custom.tread_pattern [single_line_text_field]"] || "";
}

function detectTread(blob) {
  for (const [canonical, aliases] of treadAliases) {
    if (aliases.some((a) => blob.includes(a))) return canonical;
  }
  return "";
}

function imageUrlFor(file) {
  if (!publicUrlBase) return "";
  return `${publicUrlBase}/${encodeURIComponent(path.basename(file))}`;
}

const imageFiles = walk(imagesRoot);
const imageRows = imageFiles.map((file) => {
  const rel = path.relative(imagesRoot, file);
  const parts = rel.split(path.sep);
  const sequence = (path.basename(file).match(/-([0-9]{2})\.[^.]+$/) || [])[1] || "";
  const role = roleBySequence[sequence] || { role: "supporting", position: 99, suffix: "supporting product image" };
  return {
    size: parts[0] || "",
    tread: parts[1] || "",
    sequence,
    role: role.role,
    position: role.position,
    file,
    filename: path.basename(file),
    altSuffix: role.suffix,
  };
});

const imageSizes = [...new Set(imageRows.map((r) => r.size))].sort((a, b) => compact(b).length - compact(a).length);
const products = csvParse(fs.readFileSync(productsCsv, "utf8"));
const imageGroups = new Map();
for (const row of imageRows) {
  const key = `${compact(row.size)}::${row.tread}`;
  if (!imageGroups.has(key)) imageGroups.set(key, []);
  imageGroups.get(key).push(row);
}
for (const rows of imageGroups.values()) rows.sort((a, b) => a.position - b.position || a.filename.localeCompare(b.filename));

const mediaRows = [];
const supabaseRows = [];
const unmatchedProducts = [];

for (const product of products) {
  const handle = productHandle(product);
  if (!handle) continue;
  const blob = textBlob(product);
  if (!blob.includes("rubber track") && !blob.includes("track") && !productTrackSize(product)) continue;
  const blobCompact = compact(blob);
  const explicitSize = productTrackSize(product);
  const explicitTread = productTreadPattern(product);
  const size = imageSizes.find((s) => compact(explicitSize) === compact(s)) ||
    imageSizes.find((s) => blobCompact.includes(compact(s)));
  const tread = treadAliases.find(([, aliases]) => aliases.some((a) => compact(explicitTread) === compact(a)))?.[0] ||
    detectTread(blob);
  if (!size || !tread) {
    unmatchedProducts.push({
      handle,
      sku: productSku(product),
      title: productTitle(product),
      detected_size: size,
      detected_tread: tread,
      reason: !size ? "missing_size_match" : "missing_tread_match",
    });
    continue;
  }

  const images = imageGroups.get(`${compact(size)}::${tread}`) || [];
  if (!images.length) {
    unmatchedProducts.push({
      handle,
      sku: productSku(product),
      title: productTitle(product),
      detected_size: size,
      detected_tread: tread,
      reason: "no_local_image_group",
    });
    continue;
  }

  for (const image of images) {
    const alt = `${size} ${image.tread.replace(/-/g, " ")} rubber track - ${image.altSuffix}`;
    mediaRows.push({
      Command: "MERGE",
      Handle: handle,
      "Image Command": "MERGE",
      "Image Src": imageUrlFor(image.file),
      "Image Position": image.position,
      "Image Alt Text": alt,
      "Local Image Path": image.file,
      "Image Filename": image.filename,
      "Image Role": image.role,
      "Detected Size": size,
      "Detected Tread": tread,
      "Variant SKU": productSku(product),
    });
  }

  const hero = images.find((i) => i.sequence === "01") || images[0];
  supabaseRows.push({
    handle,
    sku: productSku(product),
    image_url: imageUrlFor(hero.file),
    image_alt: `${size} ${hero.tread.replace(/-/g, " ")} rubber track - hero product view`,
    media_role: "hero",
    local_image_path: hero.file,
    detected_size: size,
    detected_tread: tread,
  });
}

fs.mkdirSync(outDir, { recursive: true });
writeCsv(path.join(outDir, "matrixify_product_media_import.csv"), mediaRows, [
  "Command",
  "Handle",
  "Image Command",
  "Image Src",
  "Image Position",
  "Image Alt Text",
  "Local Image Path",
  "Image Filename",
  "Image Role",
  "Detected Size",
  "Detected Tread",
  "Variant SKU",
]);
writeCsv(path.join(outDir, "supabase_product_image_pointer_backfill.csv"), supabaseRows, [
  "handle",
  "sku",
  "image_url",
  "image_alt",
  "media_role",
  "local_image_path",
  "detected_size",
  "detected_tread",
]);
writeCsv(path.join(outDir, "unmatched_track_products.csv"), unmatchedProducts, [
  "handle",
  "sku",
  "title",
  "detected_size",
  "detected_tread",
  "reason",
]);

const summary = {
  images_root: imagesRoot,
  products_csv: productsCsv,
  public_url_base: publicUrlBase || null,
  local_images: imageRows.length,
  image_groups: imageGroups.size,
  products_read: products.length,
  products_with_media_rows: new Set(mediaRows.map((r) => r.Handle)).size,
  media_rows: mediaRows.length,
  supabase_pointer_rows: supabaseRows.length,
  unmatched_products: unmatchedProducts.length,
  note: publicUrlBase
    ? "Image Src fields are populated."
    : "Image Src fields are blank until images are hosted at a public direct URL base.",
};
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
