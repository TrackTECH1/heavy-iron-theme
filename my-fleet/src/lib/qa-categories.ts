import type { QaCategory, QaIntent, QaPart, QaPartRow, TreadOption } from "./qa-types";

const TREAD_LABELS: Record<string, string> = {
  "Block Pattern": "C-Block",
  "C Pattern": "C Pattern",
  "ZB Pattern": "Zig-Zag",
  "Z Pattern": "Zig-Zag",
  "Zig Zag Track Pattern": "Zig-Zag",
  "Multi-Bar Pattern": "Multi-Bar",
  "XT Pattern": "X-Terrain",
  "X-Terrain Pattern": "X-Terrain",
  "BD Pattern": "Block / BD",
  "DR Pattern": "DR Pattern",
  Smooth: "Turf / Non-marking",
  "Straight Bar Pattern": "Straight Bar",
  Chevron: "Chevron",
};

export function treadLabel(pattern: string | null): string | null {
  if (!pattern) return null;
  return TREAD_LABELS[pattern] ?? pattern;
}

const INTENT_PRODUCT_TYPES: Partial<Record<QaIntent, string[]>> = {
  tracks: [
    "Rubber Track",
    "Skid Steer Tracks",
    "Mini Excavator Tracks",
    "Compact Track Loader Tracks",
    "Multi-Terrain Loader Tracks",
    "Track Pads",
  ],
  tread_options: ["Rubber Track", "Compact Track Loader Tracks", "Skid Steer Tracks"],
  sprockets: ["Sprocket"],
  idlers: ["Idler"],
  rollers: ["Roller"],
  kits: ["Undercarriage Part"],
  undercarriage: [
    "Rubber Track",
    "Skid Steer Tracks",
    "Mini Excavator Tracks",
    "Compact Track Loader Tracks",
    "Multi-Terrain Loader Tracks",
    "Track Pads",
    "Sprocket",
    "Idler",
    "Roller",
    "Undercarriage Part",
  ],
};

function normalizeSize(s: string | null): string {
  return (s ?? "").toLowerCase().replace(/bx/g, "x").replace(/\s/g, "");
}

export function assignCategory(
  productType: string | null,
  title: string | null,
): QaCategory {
  const t = (title ?? "").toLowerCase();
  const pt = productType ?? "";

  if (pt === "Sprocket" || t.includes("sprocket")) return "Sprockets";
  if (pt === "Idler" || t.includes("idler")) {
    if (t.includes("front")) return "Front Idlers";
    if (t.includes("rear")) return "Rear Idlers";
    return "Front Idlers";
  }
  if (pt === "Roller" || t.includes("roller")) {
    if (t.includes("top")) return "Top Rollers";
    return "Bottom Rollers";
  }
  if (pt.includes("Track") || pt === "Track Pads") return "Rubber Tracks";
  if (pt === "Undercarriage Part" || t.includes("kit")) return "Undercarriage Kits";
  if (t.includes("attachment")) return "Attachments";
  return "Other";
}

function partSubType(title: string | null, productType: string | null): string {
  const t = (title ?? "").toLowerCase();
  if (t.includes("front idler")) return "Front Idler";
  if (t.includes("rear idler")) return "Rear Idler";
  if (t.includes("bottom roller") || t.includes("track roller")) return "Bottom Roller";
  if (t.includes("top roller") || t.includes("carrier roller")) return "Top Roller";
  if (t.includes("sprocket")) return "Sprocket";
  if (t.includes("kit")) return "Undercarriage Kit";
  return productType ?? "Part";
}

function inferSupplier(row: QaPartRow): string | null {
  if (row.supplier_sku) return "Supplier catalog";
  const src = row.source_systems ?? row.fitment_source ?? "";
  if (src.includes("supplier")) return "Supplier";
  if (src.includes("bridgestone") || row.sku.startsWith("BS")) return "Bridgestone";
  if (row.sku.startsWith("TNT")) return "Track'n'Trail";
  return src.split("|")[0] || null;
}

function partWarnings(
  row: QaPartRow,
  machineTrackSize: string | null,
): string[] {
  const w: string[] = [];
  const qty = row.qty_available;
  if (qty == null || Number(qty) === 0) w.push("Missing inventory");
  if (row.price == null) w.push("Missing price");
  // Image gaps surface via fleet_enrichment_tasks / media resolver — not product_url
  if (
    machineTrackSize &&
    row.product_track_size &&
    normalizeSize(machineTrackSize) !== normalizeSize(row.product_track_size) &&
    (row.product_type ?? "").includes("Track") &&
    row.fitment_type !== "explicit_supplier_fitment"
  ) {
    w.push(
      `Track size mismatch: machine ${machineTrackSize} vs product ${row.product_track_size}`,
    );
  }
  if (
    row.confidence &&
    row.confidence !== "supplier" &&
    row.fitment_type === "inferred_by_track_size"
  ) {
    w.push(`Inferred fitment (${row.confidence}) — verify before quoting`);
  }
  return w;
}

export function rowToPart(row: QaPartRow, machineTrackSize: string | null): QaPart {
  return {
    sku: row.sku,
    title: row.title,
    productType: row.product_type,
    category: assignCategory(row.product_type, row.title),
    partType: partSubType(row.title, row.product_type),
    trackSize: row.product_track_size,
    pattern: row.pattern,
    treadLabel: treadLabel(row.pattern),
    price: row.price != null ? Number(row.price) : null,
    qtyAvailable: row.qty_available != null ? Number(row.qty_available) : null,
    supplier: inferSupplier(row),
    fitmentConfidence: row.confidence,
    fitmentType: row.fitment_type,
    imageUrl: null,
    warnings: partWarnings(row, machineTrackSize),
  };
}

export function dedupeParts(rows: QaPartRow[]): QaPartRow[] {
  const bySku = new Map<string, QaPartRow>();
  const rank = (r: QaPartRow) =>
    r.confidence === "supplier" ? 0 : r.fitment_type === "explicit_supplier_fitment" ? 1 : 2;

  for (const row of rows) {
    const existing = bySku.get(row.sku);
    if (!existing || rank(row) < rank(existing)) bySku.set(row.sku, row);
  }
  return [...bySku.values()];
}

export function filterByIntent(rows: QaPartRow[], intent: QaIntent): QaPartRow[] {
  if (intent === "general" || intent === "track_size" || intent === "undercarriage") return rows;

  if (intent === "tread_options") {
    return rows.filter((r) => (r.product_type ?? "").includes("Track"));
  }

  const types = INTENT_PRODUCT_TYPES[intent];
  if (!types) return rows;

  return rows.filter((r) => {
    const pt = r.product_type ?? "";
    if (types.includes(pt)) return true;
    const t = (r.title ?? "").toLowerCase();
    if (intent === "kits" && t.includes("kit")) return true;
    if (intent === "attachments" && t.includes("attachment")) return true;
    return false;
  });
}

export function groupByCategory(parts: QaPart[]): { name: QaCategory; parts: QaPart[] }[] {
  const order: QaCategory[] = [
    "Rubber Tracks",
    "Sprockets",
    "Front Idlers",
    "Rear Idlers",
    "Bottom Rollers",
    "Top Rollers",
    "Undercarriage Kits",
    "Attachments",
    "Other",
  ];
  const map = new Map<QaCategory, QaPart[]>();
  for (const p of parts) {
    const list = map.get(p.category) ?? [];
    list.push(p);
    map.set(p.category, list);
  }
  return order
    .filter((name) => map.has(name))
    .map((name) => ({
      name,
      parts: (map.get(name) ?? []).sort((a, b) => a.sku.localeCompare(b.sku)),
    }));
}

export function buildTreadOptions(parts: QaPart[]): TreadOption[] {
  const tracks = parts.filter((p) => p.category === "Rubber Tracks");
  const byPattern = new Map<string, QaPart[]>();
  for (const p of tracks) {
    const key = p.pattern ?? "Unknown";
    const list = byPattern.get(key) ?? [];
    list.push(p);
    byPattern.set(key, list);
  }
  return [...byPattern.entries()]
    .map(([pattern, items]) => ({
      pattern,
      label: treadLabel(pattern) ?? pattern,
      skuCount: items.length,
      inStockCount: items.filter((i) => (i.qtyAvailable ?? 0) > 0).length,
      sampleSkus: items.slice(0, 3).map((i) => i.sku),
    }))
    .sort((a, b) => b.skuCount - a.skuCount);
}

export const CATEGORY_SUMMARY: QaCategory[] = [
  "Rubber Tracks",
  "Sprockets",
  "Front Idlers",
  "Bottom Rollers",
  "Top Rollers",
  "Undercarriage Kits",
];
