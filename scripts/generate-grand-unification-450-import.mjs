#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve("../../outputs");
const csvPath = path.join(OUT_DIR, "HEAVY_IRON_MATRIXIFY_GRAND_UNIFICATION_450X86BX55.csv");
const notePath = path.join(OUT_DIR, "HEAVY_IRON_GRAND_UNIFICATION_450_IMPORT_NOTES.md");

function csv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

const specs = {
  track_size: "450x86Bx55",
  width_mm: 450,
  width_in: 18.0,
  pitch_mm: 86.0,
  pitch_type: "B",
  links: 55,
  warranty_months: 24,
  free_ltl_freight_lower_48: true,
  handling_days_min: 0,
  handling_days_max: 1,
  transit_days_min: 1,
  transit_days_max: 3,
  same_day_cutoff_local: "14:00 EST",
};

const fallback = {
  text: "Heavy-duty 450x86Bx55 replacement rubber tracks for Bobcat and Case compact track loaders. Premium 18-inch width, 86mm B-pitch, 55 links, in stock with free fast Lower 48 LTL freight.",
  disclosure:
    "Free Fast LTL Freight applies to commercial addresses in the contiguous Lower 48 states. Orders placed before 2:00 PM EST ship out the exact same business day when inventory is available. Residential delivery, lift-gate service, Alaska, Hawaii, Puerto Rico, and remote accessorial services may require additional charges.",
  specs,
};

const rows = [
  {
    Handle: "450x86bx55-rubber-track",
    Command: "MERGE",
    Title: '450x86Bx55 | 18" Skid Steer Rubber Tracks',
    Status: "ACTIVE",
    "Category: Name": "Business & Industrial > Heavy Machinery > Heavy Machinery Parts & Accessories",
    "SEO Title": "450x86Bx55 | 18 Inch Skid Steer Replacement Rubber Tracks",
    "SEO Description":
      "Heavy-duty 450x86Bx55 replacement rubber tracks for Bobcat & Case loaders. Features an 18-inch width for max traction. In stock, 1-3 day free shipping!",
    Tags: "450x86Bx55, 18 Inch Rubber Tracks, Bobcat T740, Case TR340, Free Fast LTL Freight, Lower 48 Shipping",
    "Metafield: custom.specs [json]": JSON.stringify(specs),
    "Metafield: custom.track_size [single_line_text_field]": "450x86Bx55",
    "Metafield: custom.width_mm [number_integer]": "450",
    "Metafield: custom.width_in [number_decimal]": "18.0",
    "Metafield: custom.pitch_mm [number_decimal]": "86.0",
    "Metafield: custom.pitch_type [single_line_text_field]": "B",
    "Metafield: custom.links [number_integer]": "55",
    "Metafield: custom.warranty_months [number_integer]": "24",
    "Metafield: custom.tracktech_data_fallback [json]": JSON.stringify(fallback),
    "Metafield: custom.shipping_type [single_line_text_field]": "Free Fast LTL Freight (Lower 48 Only)",
    "Variant Command": "MERGE",
    "Variant SKU": "TNT4508655HDBD",
    "Variant Inventory Tracker": "shopify",
    "Variant Inventory Qty": "999",
    "Variant Inventory Policy": "deny",
    "Variant Weight": "453",
    "Variant Weight Unit": "lb",
  },
];

const headers = Object.keys(rows[0]);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(csvPath, [headers.join(","), ...rows.map((row) => headers.map((header) => csv(row[header])).join(","))].join("\n"));
fs.writeFileSync(
  notePath,
  `# 450x86Bx55 Grand Unification Matrixify Import

Import type: **Products**

File:

\`HEAVY_IRON_MATRIXIFY_GRAND_UNIFICATION_450X86BX55.csv\`

This locks the Shopify core for the master \`450x86bx55-rubber-track\` product:

- Active product status
- Product title and SEO title/description
- Heavy Machinery Parts & Accessories taxonomy text
- Variant inventory tracker, quantity 999, deny oversell
- Variant weight 453 lb
- \`custom.specs\` JSON vocabulary plus existing first-class custom metafields
- Free Fast LTL Freight Lower 48 messaging

Note: Matrixify is still the right path for inventory/weight because Shopify API inventory writes need the store's inventory write scope.
`,
);

console.log(JSON.stringify({ csvPath, notePath, rows: rows.length }, null, 2));
