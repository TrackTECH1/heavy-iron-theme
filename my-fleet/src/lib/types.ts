export type FleetBrand = {
  brand_id: string;
  brand: string;
  brand_canonical: string;
  aliases: string | null;
  sources: string | null;
  active_model_count?: number;
  total_model_count?: number;
};

export type FleetMachine = {
  machine_id: string;
  brand_id: string;
  brand: string;
  model: string;
  model_canonical: string;
  machine_type: string | null;
  mount_type: string | null;
  track_size_id: string | null;
  primary_track_size: string | null;
  horsepower: number | null;
  operating_weight_lbs: number | null;
  std_gpm: number | null;
  hf_gpm: number | null;
  std_psi: number | null;
  lift_type: string | null;
  coupler_type: string | null;
  validation_status: string | null;
  source_systems: string | null;
  machine_status: string | null;
  canonical_model_group: string | null;
  shopify_handle: string | null;
  shopify_url: string | null;
  navigation_source: string | null;
};

export type FleetFitment = {
  fitment_id: string;
  machine_id: string;
  product_id: string;
  brand: string;
  model: string;
  machine_type: string | null;
  machine_track_size: string | null;
  sku: string;
  title: string | null;
  product_type: string | null;
  product_track_size: string | null;
  fitment_type: string | null;
  confidence: string | null;
  source: string | null;
};

export type FleetTrackSize = {
  track_size_id: string;
  canonical_size: string;
  product_count: number;
  machine_count: number;
  fitment_count: number;
};

export type FleetProduct = {
  product_id: string;
  sku: string;
  supplier_sku: string | null;
  shopify_sku: string | null;
  title: string | null;
  product_type: string | null;
  track_size_id: string | null;
  track_size: string | null;
  pattern: string | null;
  cost: number | null;
  price: number | null;
  qty_available: number | null;
  weight_lbs: number | null;
  product_url: string | null;
  source_systems: string | null;
};

export type ReviewWarning = {
  queue: string;
  summary: string;
  detail?: string;
};
