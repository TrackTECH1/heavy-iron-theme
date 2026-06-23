export type QaIntent =
  | "tracks"
  | "tread_options"
  | "undercarriage"
  | "sprockets"
  | "rollers"
  | "idlers"
  | "kits"
  | "attachments"
  | "track_size"
  | "general";

export type QaCategory =
  | "Rubber Tracks"
  | "Sprockets"
  | "Front Idlers"
  | "Rear Idlers"
  | "Bottom Rollers"
  | "Top Rollers"
  | "Undercarriage Kits"
  | "Attachments"
  | "Other";

export type QaPart = {
  sku: string;
  title: string | null;
  productType: string | null;
  category: QaCategory;
  partType: string;
  trackSize: string | null;
  pattern: string | null;
  treadLabel: string | null;
  price: number | null;
  qtyAvailable: number | null;
  supplier: string | null;
  fitmentConfidence: string | null;
  fitmentType: string | null;
  imageUrl: string | null;
  warnings: string[];
};

export type TreadOption = {
  pattern: string;
  label: string;
  skuCount: number;
  inStockCount: number;
  sampleSkus: string[];
};

export type QaTrackGroup = {
  name: "Wide Tracks" | "Alternate Tracks" | "Narrow Tracks" | "Other / Review";
  trackSizeLabel: string | null;
  parts: QaPart[];
};

export type QaAnswer = {
  question: string;
  intent: QaIntent;
  intentLabel: string;
  machine: {
    machine_id: string;
    brand: string;
    model: string;
    machine_type: string | null;
    primary_track_size: string | null;
    validation_status: string | null;
    horsepower?: number | null;
    operating_weight_lbs?: number | null;
    std_gpm?: number | null;
    std_psi?: number | null;
    lift_type?: string | null;
    mount_type?: string | null;
  } | null;
  trackSize: {
    track_size_id: string;
    canonical_size: string;
  } | null;
  treadOptions: TreadOption[];
  machineTrackSizeOptions: import("./track-size-options").MachineTrackSizeOption[];
  trackParts: QaPart[];
  trackGroups: QaTrackGroup[];
  categories: { name: QaCategory; parts: QaPart[] }[];
  warnings: string[];
  sources: string[];
  contextMachineId: string | null;
};

export type ParsedQaQuery = {
  intent: QaIntent;
  machineQuery: string | null;
  trackSizeQuery: string | null;
  usesContext: boolean;
  rawQuestion: string;
};

export type QaPartRow = {
  fitment_id: string;
  machine_id: string;
  brand: string;
  model: string;
  model_canonical: string;
  machine_type: string | null;
  machine_track_size: string | null;
  machine_track_size_id: string | null;
  product_id: string;
  sku: string;
  supplier_sku: string | null;
  title: string | null;
  product_type: string | null;
  pattern: string | null;
  product_track_size_id: string | null;
  product_track_size: string | null;
  price: number | null;
  qty_available: number | null;
  cost: number | null;
  product_url: string | null;
  source_systems: string | null;
  fitment_type: string | null;
  confidence: string | null;
  fitment_source: string | null;
};
