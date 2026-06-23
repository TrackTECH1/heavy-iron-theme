import { getMachine, getMachineTrackSizeOptions, getProducts, getTrackSizes, searchMachines } from "./queries";
import {
  buildTreadOptions,
  dedupeParts,
  filterByIntent,
  groupByCategory,
  rowToPart,
} from "./qa-categories";
import { intentLabel, parseQaQuestion } from "./qa-parser";
import type { QaAnswer, QaPartRow } from "./qa-types";
import { createFleetClient } from "./supabase";
import { getMachineReviewWarnings } from "./review-queues";
import { finalizeMachineTrackSizeOptions } from "./track-size-options";
import { filterV2QaParts } from "./track-size-v2";
import { buildTrackGroups } from "./track-grouping";

async function fetchQaPartsForMachine(machineId: string): Promise<QaPartRow[]> {
  const supabase = createFleetClient();
  const { data, error } = await supabase
    .from("fleet_qa_parts")
    .select("*")
    .eq("machine_id", machineId)
    .limit(2000);
  if (error) throw new Error(error.message);
  return filterV2QaParts((data ?? []) as QaPartRow[]);
}

async function fetchQaPartsByTrackSize(canonicalFragment: string): Promise<QaPartRow[]> {
  const supabase = createFleetClient();
  const { data, error } = await supabase
    .from("fleet_qa_parts")
    .select("*")
    .ilike("product_track_size", `%${canonicalFragment}%`)
    .limit(200);
  if (error) throw new Error(error.message);
  return filterV2QaParts(dedupeParts((data ?? []) as QaPartRow[]));
}

async function resolveMachine(
  machineQuery: string | null,
  contextMachineId: string | null,
  usesContext: boolean,
) {
  if (usesContext && contextMachineId) {
    return getMachine(contextMachineId);
  }
  if (!machineQuery) return null;

  const results = await searchMachines(machineQuery, 5);
  if (results.length === 0) return null;

  const exact = results.find(
    (m) =>
      machineQuery.toLowerCase().includes(m.model.toLowerCase()) &&
      machineQuery.toLowerCase().includes(m.brand.toLowerCase().split(" ")[0]),
  );
  return exact ?? results[0];
}

async function resolveTrackSize(query: string | null) {
  if (!query) return null;
  const sizes = await getTrackSizes(query);
  const normalized = query.toLowerCase().replace(/bx/g, "x");
  return (
    sizes.find((s) => s.canonical_size.toLowerCase().replace(/bx/g, "x").includes(normalized)) ??
    sizes[0] ??
    null
  );
}

export async function answerPartsQuestion(
  question: string,
  contextMachineId?: string | null,
): Promise<QaAnswer> {
  const parsed = parseQaQuestion(question, contextMachineId);
  const sources: string[] = [];
  const warnings: string[] = [];

  let machine = await resolveMachine(
    parsed.machineQuery,
    contextMachineId ?? null,
    parsed.usesContext,
  );
  let trackSize = await resolveTrackSize(parsed.trackSizeQuery);

  let rows: QaPartRow[] = [];

  if (machine) {
    sources.push("public.fleet_qa_parts", "core.fitment", "core.v_fitment_godlist");
    rows = await fetchQaPartsForMachine(machine.machine_id);
    if (!trackSize && machine.track_size_id) {
      trackSize = {
        track_size_id: machine.track_size_id,
        canonical_size: machine.primary_track_size ?? "",
        product_count: 0,
        machine_count: 0,
        fitment_count: rows.length,
      };
    }
    const reviewWarnings = getMachineReviewWarnings(machine);
    warnings.push(...reviewWarnings.map((w) => w.summary));
  } else if (parsed.intent === "track_size" && parsed.trackSizeQuery) {
    sources.push("public.fleet_qa_parts", "public.fleet_products");
    rows = await fetchQaPartsByTrackSize(parsed.trackSizeQuery);
    if (rows.length === 0) {
      const { rows: products } = await getProducts({ search: parsed.trackSizeQuery, page: 0 });
      rows = products.map((p) => ({
        fitment_id: `size-${p.sku}`,
        machine_id: "",
        brand: "",
        model: "",
        model_canonical: "",
        machine_type: null,
        machine_track_size: null,
        machine_track_size_id: null,
        product_id: p.product_id,
        sku: p.sku,
        supplier_sku: p.supplier_sku,
        title: p.title,
        product_type: p.product_type,
        pattern: p.pattern,
        product_track_size_id: p.track_size_id,
        product_track_size: p.track_size,
        price: p.price,
        qty_available: p.qty_available,
        cost: p.cost,
        product_url: p.product_url,
        source_systems: p.source_systems,
        fitment_type: null,
        confidence: null,
        fitment_source: null,
      }));
    }
    trackSize = await resolveTrackSize(parsed.trackSizeQuery);
  } else if (parsed.machineQuery) {
    warnings.push(`No machine matched "${parsed.machineQuery}". Try "John Deere 323E" or "CAT 299D3".`);
  }

  if (!machine && parsed.usesContext) {
    warnings.push("No machine context — search a machine first or include brand + model.");
  }

  rows = filterV2QaParts(dedupeParts(rows));
  rows = filterByIntent(rows, parsed.intent);

  const machineTrackSize = machine?.primary_track_size ?? null;
  const parts = rows.map((r) => rowToPart(r, machineTrackSize));
  const dbTrackOptions = machine
    ? await getMachineTrackSizeOptions(machine.machine_id)
    : [];
  const machineTrackSizeOptions = machine
    ? finalizeMachineTrackSizeOptions(dbTrackOptions)
    : [];

  const trackParts = parts.filter((p) => p.category === "Rubber Tracks");
  const nonTrackCategories = groupByCategory(parts.filter((p) => p.category !== "Rubber Tracks"));

  const showTrackGroups =
    parsed.intent === "tracks" ||
    parsed.intent === "tread_options" ||
    parsed.intent === "general";

  const trackGroups = showTrackGroups
    ? buildTrackGroups(trackParts, machineTrackSizeOptions)
    : [];

  const categories =
    showTrackGroups && trackGroups.length > 0
      ? nonTrackCategories
      : groupByCategory(parts);

  if (machineTrackSizeOptions.length > 0) {
    sources.push("machine_track_size_options");
  }
  const treadOptions = buildTreadOptions(parts);

  if (parsed.intent === "tread_options" && treadOptions.length === 0 && machine) {
    warnings.push("No tread patterns found in fitment data for this machine.");
  }

  const activeContext = machine?.machine_id ?? contextMachineId ?? null;

  return {
    question: parsed.rawQuestion,
    intent: parsed.intent,
    intentLabel: intentLabel(parsed.intent),
    machine: machine
      ? {
          machine_id: machine.machine_id,
          brand: machine.brand,
          model: machine.model,
          machine_type: machine.machine_type,
          primary_track_size: machine.primary_track_size,
          validation_status: machine.validation_status,
          horsepower: machine.horsepower,
          operating_weight_lbs: machine.operating_weight_lbs,
          std_gpm: machine.std_gpm,
          std_psi: machine.std_psi,
          lift_type: machine.lift_type,
          mount_type: machine.mount_type,
        }
      : null,
    trackSize: trackSize
      ? {
          track_size_id: trackSize.track_size_id,
          canonical_size: trackSize.canonical_size,
        }
      : null,
    treadOptions,
    machineTrackSizeOptions,
    trackParts,
    trackGroups,
    categories,
    warnings,
    sources: [...new Set(sources)],
    contextMachineId: activeContext,
  };
}
