#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("../..");
const outputs = path.join(root, "outputs");

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(file, rows) {
  const headers = Object.keys(rows[0]);
  const body = [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n");
  fs.writeFileSync(path.join(outputs, file), `${body}\n`);
}

const siloRows = [
  {
    silo: "Product ground truth",
    url_pattern: "/products/[product-handle]",
    example_url: "/products/450x86bx55-rubber-track",
    primary_intent: "Buyer knows the part size, SKU, or exact replacement product.",
    canonical_rule: "Self-canonical. Never nest product URLs under machine, brand, or collection paths.",
    source_of_truth: "Shopify product record synced from Supabase product/spec/fitment facts.",
    shopify_owner: "Product, variants, media, price, inventory, custom specs metafield, fitment references.",
    supabase_owner: "Normalized product specs, model fitments, SKU logic, enrichment pipeline.",
    required_template: "Product PDP with dynamic JSON-LD, freight trust strip, purchase gates, fitment/spec tabs.",
    implementation_status: "Theme has PDP schema, freight strip, machine-context banner, and agentic JSON-LD foundations.",
  },
  {
    silo: "Machine hub",
    url_pattern: "/machines/[make]/[model]",
    example_url: "/machines/bobcat/t740",
    primary_intent: "Buyer knows the machine and wants all compatible parts.",
    canonical_rule: "Self-canonical. Links into product URLs with ?machine=Make-Model context.",
    source_of_truth: "Supabase model and fitment graph cached into Shopify metaobjects/metafields.",
    shopify_owner: "Machine metaobject page/template, storefront copy, product reference lists.",
    supabase_owner: "Make/model normalization, machine type, track size, notes, verified fitment confidence.",
    required_template: "Machine DNA hero, part-zone grid, compatible rubber tracks, undercarriage parts, attachments.",
    implementation_status: "Existing machine-fitment section present; next pass should hydrate all machine hubs from the graph.",
  },
  {
    silo: "Dimension net",
    url_pattern: "/collections/[width]-rubber-tracks or /collections/[category]-[size]",
    example_url: "/collections/18-inch-rubber-tracks",
    primary_intent: "Fleet or procurement buyer compares all tracks in a physical size class.",
    canonical_rule: "Self-canonical collection. Product cards link to flat product URLs.",
    source_of_truth: "Shopify smart/custom collections backed by Supabase track dimensions.",
    shopify_owner: "Collections, filters, product grid, SEO title/body.",
    supabase_owner: "Track width, pitch, pitch type, link count, tread family, compatible models.",
    required_template: "Dimension page with pitch/link/tread filters and application matrix banner.",
    implementation_status: "Application data is now available through Worker and product schema; collections need build/import.",
  },
  {
    silo: "OEM graveyard",
    url_pattern: "/oem-parts/[brand]-[oem-part-number]",
    example_url: "/oem-parts/bobcat-6680152",
    primary_intent: "Mechanic searches old OEM, retired, replacement, or superseded part number.",
    canonical_rule: "Canonical should point to the replacement product after verified mapping exists.",
    source_of_truth: "Supabase OEM supersession table only. Do not fabricate OEM chains.",
    shopify_owner: "Page or app route that explains retired/replaced part and links to product.",
    supabase_owner: "OEM part number, supersession chain, replacement SKU, source confidence, notes.",
    required_template: "OEM part page with old number, replacement product, fitment warning, canonical to product.",
    implementation_status: "Architecture defined; requires verified OEM/supersession dataset before publishing.",
  },
  {
    silo: "Vocation hub",
    url_pattern: "/collections/[application]-tracks",
    example_url: "/collections/demolition-tracks",
    primary_intent: "Contractor searches by jobsite condition: snow, mud, demolition, turf, landscaping.",
    canonical_rule: "Self-canonical collection. Product links append ?application=[hub] context.",
    source_of_truth: "Tread application matrix derived from Supabase specs and Shopify variant/product metafields.",
    shopify_owner: "Collection page, product filtering, SEO body, visual tread matrix.",
    supabase_owner: "Tread family to terrain/industry/climate mapping.",
    required_template: "Application copy, tread comparison, filtered product grid, context link to PDP.",
    implementation_status: "Worker endpoint and JSON-LD application layer implemented; collection imports still needed.",
  },
  {
    silo: "Location/context layer",
    url_pattern: "/collections/[application]-tracks?region=[state] or edge-applied query context",
    example_url: "/products/450x86bx55-rubber-track?region=Minnesota&application=snow-removal",
    primary_intent: "Buyer needs region-season fit: winter lots, swamp work, local freight timing.",
    canonical_rule: "Do not create doorway-page duplicates. Prefer parameterized personalization or true regional pages with real content.",
    source_of_truth: "Cloudflare geo/month hints plus product application matrix.",
    shopify_owner: "Visible PDP/collection context banner and buyer-selectable variant.",
    supabase_owner: "None for generic geo. Add regional warehouse/lead-time data only when verified.",
    required_template: "Context banner, optional recommended tread, never forced checkout without override.",
    implementation_status: "PDP context banner accepts region/application parameters; Worker can recommend tread by climate/terrain.",
  },
];

const applicationRows = [
  {
    tread_family: "C-Block",
    collection_handle: "demolition-tracks",
    collection_url: "/collections/demolition-tracks",
    terrain: ["Concrete", "Jagged Rock", "Asphalt", "Sharp Gravel"],
    industry: ["Demolition", "Paving", "Concrete Removal"],
    climate: ["All-Weather"],
    primary_query_intent: "best skid steer tracks for demolition and concrete",
    jsonld_property: "Primary Vocation Match: Demolition, paving, concrete removal, jagged rock, asphalt, and sharp gravel",
    engineering_benefit: "Stabilizes hard-surface work, reduces vibration on pavement, and helps resist chunking from concrete and sharp aggregate.",
  },
  {
    tread_family: "Z-Max",
    collection_handle: "deep-mud-tracks",
    collection_url: "/collections/deep-mud-tracks",
    terrain: ["Deep Mud", "Swamp", "Loose Clay", "Wet Slop"],
    industry: ["Forestry", "Excavation", "Site Prep"],
    climate: ["High-Precipitation"],
    primary_query_intent: "best rubber tracks for mud and wet clay",
    jsonld_property: "Primary Vocation Match: Deep mud, swamp, loose clay, forestry, excavation, and high-precipitation jobsites",
    engineering_benefit: "Clears mud aggressively and maintains forward bite in wet soil, swamp, and loose clay conditions.",
  },
  {
    tread_family: "Staggered Block",
    collection_handle: "landscaping-tracks",
    collection_url: "/collections/landscaping-tracks",
    terrain: ["Turf", "Finished Lawns", "Dry Soil", "Moderate Ground"],
    industry: ["Landscaping", "Golf Courses", "Property Maintenance"],
    climate: ["Dry", "Moderate"],
    primary_query_intent: "best skid steer tracks for landscaping and lawns",
    jsonld_property: "Primary Vocation Match: Landscaping, turf, finished lawns, golf course maintenance, dry soil, and moderate ground conditions",
    engineering_benefit: "Spreads ground pressure to reduce turf disturbance while keeping enough bite for mixed landscaping work.",
  },
  {
    tread_family: "Multi-Bar",
    collection_handle: "skid-steer-snow-tracks",
    collection_url: "/collections/skid-steer-snow-tracks",
    terrain: ["Snow", "Ice", "Slush", "Hard-Pack"],
    industry: ["Snow Removal", "Agriculture", "Municipal Work"],
    climate: ["Winter", "Sub-Zero"],
    primary_query_intent: "best skid steer tracks for snow removal",
    jsonld_property: "Primary Vocation Match: Snow removal, ice, slush, winter agriculture, and sub-zero operations",
    engineering_benefit: "Adds linear biting edges for snow, ice, and slush traction where standard block patterns can skate.",
  },
  {
    tread_family: "All-Terrain",
    collection_handle: "general-construction-tracks",
    collection_url: "/collections/general-construction-tracks",
    terrain: ["Dirt", "Clay", "Gravel", "Mixed Subdivisions"],
    industry: ["Excavation", "Site Prep", "General Construction"],
    climate: ["All-Weather"],
    primary_query_intent: "best all terrain rubber tracks for skid steer",
    jsonld_property: "Primary Vocation Match: Excavation, site prep, dirt, clay, mixed subdivisions, and general construction",
    engineering_benefit: "Balances ride quality, self-cleaning, and traction across everyday dirt, clay, gravel, and mixed construction surfaces.",
  },
];

const blueprint = `# Heavy Iron Supply Co. URL And Application Architecture

Generated: ${new Date().toISOString()}

## Source Of Truth

Supabase/Postgres remains the source of truth for normalized products, machine models, fitments, dimensions, OEM mappings, and enrichment rules. Shopify is the commerce execution layer: products, variants, media, price, inventory, collections, checkout, and storefront-accessible metafields/metaobjects. Matrixify is the controlled bulk transport layer into Shopify, not the database of record.

## Canonical Rule

Products stay flat at \`/products/[handle]\`. Machine, dimension, OEM, vocation, and location pages are intent nets that point back to canonical products. Do not create nested product URLs such as \`/tracks/bobcat/450x86bx55\`.

## URL Silos

| Silo | URL Pattern | Example | Canonical |
| --- | --- | --- | --- |
${siloRows.map((row) => `| ${row.silo} | \`${row.url_pattern}\` | \`${row.example_url}\` | ${row.canonical_rule} |`).join("\n")}

## Application Matrix

| Tread Family | Hub | Terrain | Industry | Climate |
| --- | --- | --- | --- | --- |
${applicationRows.map((row) => `| ${row.tread_family} | \`${row.collection_url}\` | ${row.terrain.join(", ")} | ${row.industry.join(", ")} | ${row.climate.join(", ")} |`).join("\n")}

## Implemented In This Pass

- Product pages now show a context banner when reached with \`?machine=\`, \`?target_machine=\`, \`?application=\`, \`?vocation=\`, \`?region=\`, \`?state=\`, or \`?market=\`.
- Product JSON-LD now adds \`Primary Vocation Match\` and \`Engineering Benefit\` when tread pattern data is present.
- Agentic catalog generation now attaches application data to track products.
- Agentic Worker now serves \`/application-matrix.json\` and \`/api/agentic/recommend-tread\`.

## Publishing Rules

- Machine hubs can be created as Shopify metaobject-backed pages, but the model/fitment graph should be generated from Supabase.
- OEM graveyard pages should not go live until OEM part numbers and supersession chains are verified.
- Geo-routing should recommend and explain tread choice, not silently force a variant without a buyer override.
- Regional pages should only exist when they add real regional shipping, climate, inventory, or service content. Otherwise use parameterized context to avoid doorway-page risk.
`;

fs.mkdirSync(outputs, { recursive: true });
fs.writeFileSync(path.join(outputs, "HEAVY_IRON_URL_ARCHITECTURE_BLUEPRINT.md"), blueprint);
writeCsv("HEAVY_IRON_URL_SILO_MATRIX.csv", siloRows);
writeCsv("HEAVY_IRON_APPLICATION_MATRIX.csv", applicationRows);
console.log(JSON.stringify({ outputs, files: ["HEAVY_IRON_URL_ARCHITECTURE_BLUEPRINT.md", "HEAVY_IRON_URL_SILO_MATRIX.csv", "HEAVY_IRON_APPLICATION_MATRIX.csv"] }, null, 2));
