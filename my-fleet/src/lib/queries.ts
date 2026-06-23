import { createFleetClient } from "./supabase";
import type {
  FleetBrand,
  FleetFitment,
  FleetMachine,
  FleetProduct,
  FleetTrackSize,
} from "./types";

import type { MachineTrackSizeOption } from "./track-size-options";
import type { QaPartRow } from "./qa-types";
import { filterV2QaParts } from "./track-size-v2";
import {
  buildMediaContext,
  type FleetMediaRow,
  type MediaContext,
} from "./media-resolver";

const PAGE_SIZE = 50;

function machineTable(catalogOnly: boolean) {
  return catalogOnly ? "fleet_machine_catalog" : "fleet_machine_godlist";
}

export async function searchMachines(
  query: string,
  limit = 20,
  opts?: { includeHidden?: boolean },
): Promise<FleetMachine[]> {
  const supabase = createFleetClient();
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  let q = supabase.from(machineTable(!opts?.includeHidden)).select("*");

  if (tokens.length === 1) {
    const t = tokens[0];
    q = q.or(`brand.ilike.%${t}%,model.ilike.%${t}%,machine_id.ilike.%${t}%`);
  } else if (tokens.length >= 2) {
    const model = tokens[tokens.length - 1];
    const brand = tokens.slice(0, -1).join(" ");
    q = q.ilike("brand", `%${brand}%`).ilike("model", `%${model}%`);
  }

  const { data, error } = await q.limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as FleetMachine[];
}

export async function getMachine(machineId: string): Promise<FleetMachine | null> {
  const supabase = createFleetClient();
  const { data, error } = await supabase
    .from("fleet_machine_godlist")
    .select("*")
    .eq("machine_id", machineId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as FleetMachine | null;
}

export async function getBrands(): Promise<FleetBrand[]> {
  const supabase = createFleetClient();
  const { data, error } = await supabase
    .from("fleet_brands_catalog")
    .select("*")
    .order("brand");
  if (error) throw new Error(error.message);
  return (data ?? []) as FleetBrand[];
}

export async function getBrand(brandId: string): Promise<FleetBrand | null> {
  const supabase = createFleetClient();
  const { data, error } = await supabase
    .from("fleet_brands")
    .select("*")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as FleetBrand | null;
}

export async function getMachineTypes(): Promise<string[]> {
  const supabase = createFleetClient();
  const { data, error } = await supabase
    .from("fleet_machine_types_catalog")
    .select("machine_type")
    .order("machine_type");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.machine_type as string);
}

export async function getModels(opts?: {
  brandId?: string;
  trackSizeId?: string;
  machineType?: string;
  search?: string;
  page?: number;
  includeHidden?: boolean;
}): Promise<{ rows: FleetMachine[]; total: number }> {
  const supabase = createFleetClient();
  const page = opts?.page ?? 0;
  const table = machineTable(!opts?.includeHidden);
  let q = supabase
    .from(table)
    .select("*", { count: "exact" })
    .order("brand")
    .order("model")
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

  if (opts?.brandId) q = q.eq("brand_id", opts.brandId);
  if (opts?.trackSizeId) q = q.eq("track_size_id", opts.trackSizeId);
  if (opts?.machineType) q = q.eq("machine_type", opts.machineType);
  if (opts?.search) {
    const t = opts.search;
    q = q.or(`brand.ilike.%${t}%,model.ilike.%${t}%`);
  }

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as FleetMachine[], total: count ?? 0 };
}

export async function getTrackSizes(search?: string): Promise<FleetTrackSize[]> {
  const supabase = createFleetClient();
  let q = supabase
    .from("fleet_track_size_spine")
    .select("*")
    .order("canonical_size");
  if (search) q = q.ilike("canonical_size", `%${search}%`);
  const { data, error } = await q.limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as FleetTrackSize[];
}

export async function getTrackSize(trackSizeId: string): Promise<FleetTrackSize | null> {
  const supabase = createFleetClient();
  const { data, error } = await supabase
    .from("fleet_track_size_spine")
    .select("*")
    .eq("track_size_id", trackSizeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as FleetTrackSize | null;
}

export async function getProducts(opts?: {
  search?: string;
  trackSizeId?: string;
  page?: number;
}): Promise<{ rows: FleetProduct[]; total: number }> {
  const supabase = createFleetClient();
  const page = opts?.page ?? 0;
  let q = supabase
    .from("fleet_products")
    .select("*", { count: "exact" })
    .order("sku")
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

  if (opts?.trackSizeId) q = q.eq("track_size_id", opts.trackSizeId);
  if (opts?.search) {
    const t = opts.search;
    q = q.or(`sku.ilike.%${t}%,title.ilike.%${t}%`);
  }

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as FleetProduct[], total: count ?? 0 };
}

export async function getProductBySku(sku: string): Promise<FleetProduct | null> {
  const supabase = createFleetClient();
  const { data, error } = await supabase
    .from("fleet_products")
    .select("*")
    .eq("sku", sku)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as FleetProduct | null;
}

export async function getFitments(opts?: {
  brand?: string;
  model?: string;
  sku?: string;
  machineId?: string;
  productId?: string;
  page?: number;
}): Promise<{ rows: FleetFitment[]; total: number }> {
  const supabase = createFleetClient();
  const page = opts?.page ?? 0;
  let q = supabase
    .from("fleet_fitment_godlist")
    .select("*", { count: "exact" })
    .order("brand")
    .order("model")
    .order("sku")
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

  if (opts?.brand) q = q.ilike("brand", opts.brand);
  if (opts?.model) q = q.ilike("model", `%${opts.model}%`);
  if (opts?.sku) q = q.eq("sku", opts.sku);
  if (opts?.machineId) q = q.eq("machine_id", opts.machineId);
  if (opts?.productId) q = q.eq("product_id", opts.productId);

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as FleetFitment[], total: count ?? 0 };
}

export async function getMachineTrackSizeOptions(
  machineId: string,
): Promise<MachineTrackSizeOption[]> {
  const supabase = createFleetClient();
  const { data, error } = await supabase
    .from("fleet_machine_track_size_options")
    .select("*")
    .eq("machine_id", machineId)
    .order("display_priority")
    .order("canonical_size");
  if (error) throw new Error(error.message);
  return (data ?? []) as MachineTrackSizeOption[];
}

export async function getMachineQaParts(machineId: string): Promise<QaPartRow[]> {
  const supabase = createFleetClient();
  const { data, error } = await supabase
    .from("fleet_qa_parts")
    .select("*")
    .eq("machine_id", machineId)
    .limit(2000);
  if (error) throw new Error(error.message);
  return filterV2QaParts((data ?? []) as QaPartRow[]);
}

export type EnrichmentTask = {
  task_type: string;
  entity_id: string;
  entity_label: string;
  detail: string;
  suggested_action: string;
};

export async function getEnrichmentTasks(limit = 100): Promise<EnrichmentTask[]> {
  const supabase = createFleetClient();
  const { data, error } = await supabase
    .from("fleet_enrichment_tasks")
    .select("*")
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as EnrichmentTask[];
}

export async function loadMediaContext(
  machineId: string,
  trackSizeIds: string[],
  skus: string[],
): Promise<MediaContext> {
  const supabase = createFleetClient();

  const heroRes = await supabase
    .from("fleet_model_hero")
    .select("url")
    .eq("machine_id", machineId)
    .maybeSingle();

  let trackRows: FleetMediaRow[] = [];
  if (trackSizeIds.length > 0) {
    const trackRes = await supabase
      .from("fleet_track_size_media")
      .select("track_size_id, canonical_size, tread_pattern, display_priority, url, role")
      .in("track_size_id", trackSizeIds)
      .limit(500);
    if (trackRes.error) throw new Error(trackRes.error.message);
    trackRows = (trackRes.data ?? []) as FleetMediaRow[];
  }

  let productRows: FleetMediaRow[] = [];
  if (skus.length > 0) {
    const productRes = await supabase
      .from("fleet_product_media")
      .select("sku, url")
      .in("sku", skus)
      .limit(500);
    if (productRes.error) throw new Error(productRes.error.message);
    productRows = (productRes.data ?? []) as FleetMediaRow[];
  }

  if (heroRes.error) throw new Error(heroRes.error.message);

  return buildMediaContext({
    machineHeroUrl: (heroRes.data as { url: string | null } | null)?.url ?? null,
    trackRows,
    productRows,
  });
}
