import type { QaCategory, QaPart } from "./qa-types";
import type { MachineTrackSizeOption } from "./track-size-options";
import type { PartsCounterMachine, PartsCounterTrackGroup } from "./parts-counter-results";
import { buildPartsCounterView } from "./parts-counter-results";
import {
  hasCarriedListing,
  isCarriedPart,
  oemNumberForPart,
  partPassesTierFilter,
  sortParts,
} from "./fitment-utils";

export type FitmentTabId =
  | "tracks"
  | "sprockets"
  | "front-idlers"
  | "rear-idlers"
  | "rollers"
  | "attachments"
  | "oem-refs";

export const FITMENT_TABS: { id: FitmentTabId; label: string }[] = [
  { id: "tracks", label: "Tracks" },
  { id: "sprockets", label: "Sprockets" },
  { id: "front-idlers", label: "Front Idlers" },
  { id: "rear-idlers", label: "Rear Idlers" },
  { id: "rollers", label: "Rollers" },
  { id: "attachments", label: "Attachments" },
  { id: "oem-refs", label: "OEM Refs" },
];

export type MachineFitmentSpecs = {
  machine_type: string | null;
  primary_track_size: string | null;
  horsepower: number | null;
  operating_weight_lbs: number | null;
  std_gpm: number | null;
  std_psi: number | null;
  lift_type: string | null;
  mount_type: string | null;
};

export type FitmentProductRow = {
  status: "carried" | "oem_reference_only";
  title: string;
  oemNumber: string | null;
  sku: string | null;
  price: number | null;
  qtyAvailable: number | null;
  supplier: string | null;
  imageUrl: string | null;
};

export type OemRefRow = {
  label: string;
  oemNumber: string | null;
  status: "carried" | "reference_only" | "none";
  linkedSku: string | null;
  price: number | null;
  qtyAvailable: number | null;
};

const OEM_SLOTS: { label: string; categories: QaCategory[]; partTypes?: string[] }[] = [
  { label: "Sprocket P/N", categories: ["Sprockets"], partTypes: ["Sprocket"] },
  { label: "Front Idler P/N", categories: ["Front Idlers"], partTypes: ["Front Idler"] },
  { label: "Rear Idler P/N", categories: ["Rear Idlers"], partTypes: ["Rear Idler"] },
  { label: "Bottom Roller P/N", categories: ["Bottom Rollers"], partTypes: ["Bottom Roller"] },
  { label: "Top Roller P/N", categories: ["Top Rollers"], partTypes: ["Top Roller"] },
];

function partsForTab(tab: FitmentTabId, allParts: QaPart[]): QaPart[] {
  const nonTrack = allParts.filter((p) => p.category !== "Rubber Tracks");
  switch (tab) {
    case "sprockets":
      return nonTrack.filter((p) => p.category === "Sprockets");
    case "front-idlers":
      return nonTrack.filter((p) => p.category === "Front Idlers");
    case "rear-idlers":
      return nonTrack.filter((p) => p.category === "Rear Idlers");
    case "rollers":
      return nonTrack.filter(
        (p) => p.category === "Bottom Rollers" || p.category === "Top Rollers",
      );
    case "attachments":
      return nonTrack.filter((p) => p.category === "Attachments");
    default:
      return [];
  }
}

function dedupeBySku(parts: QaPart[]): QaPart[] {
  const map = new Map<string, QaPart>();
  for (const p of sortParts(parts)) {
    if (!map.has(p.sku)) map.set(p.sku, p);
  }
  return [...map.values()];
}

function partToProductRow(part: QaPart, carried: boolean): FitmentProductRow {
  return {
    status: carried ? "carried" : "oem_reference_only",
    title: part.title ?? part.partType,
    oemNumber: oemNumberForPart(part),
    sku: part.sku,
    price: part.price,
    qtyAvailable: part.qtyAvailable,
    supplier: part.supplier,
    imageUrl: part.imageUrl,
  };
}

export function buildCategoryTabRows(
  tab: FitmentTabId,
  allParts: QaPart[],
  includeSecondary: boolean,
): FitmentProductRow[] {
  const candidates = dedupeBySku(partsForTab(tab, allParts));
  const rows: FitmentProductRow[] = [];
  const seenOem = new Set<string>();

  for (const part of sortParts(candidates)) {
    if (!partPassesTierFilter(part, includeSecondary)) continue;
    const carried = hasCarriedListing(part);
    if (carried || includeSecondary) {
      rows.push(partToProductRow(part, carried && isCarriedPart(part)));
      const oem = oemNumberForPart(part);
      if (oem) seenOem.add(oem);
    }
  }

  if (rows.length === 0) {
    for (const part of sortParts(candidates)) {
      const oem = oemNumberForPart(part);
      if (!oem || seenOem.has(oem)) continue;
      seenOem.add(oem);
      rows.push(partToProductRow(part, false));
    }
  }

  return rows;
}

function slotCandidates(allParts: QaPart[], slot: (typeof OEM_SLOTS)[number]): QaPart[] {
  const nonTrack = allParts.filter((p) => p.category !== "Rubber Tracks");
  return nonTrack.filter(
    (p) =>
      slot.categories.includes(p.category) ||
      (slot.partTypes?.includes(p.partType) ?? false),
  );
}

export function buildOemRefsTab(
  machine: PartsCounterMachine,
  specs: MachineFitmentSpecs,
  allParts: QaPart[],
): { specs: { label: string; value: string | null }[]; refs: OemRefRow[] } {
  const specRows = [
    { label: "Machine type", value: specs.machine_type },
    { label: "Operating weight", value: specs.operating_weight_lbs ? `${specs.operating_weight_lbs} lbs` : null },
    { label: "Horsepower", value: specs.horsepower ? `${specs.horsepower} HP` : null },
    { label: "Standard flow", value: specs.std_gpm ? `${specs.std_gpm} GPM` : null },
    { label: "Hydraulic pressure", value: specs.std_psi ? `${specs.std_psi} PSI` : null },
    { label: "Lift type", value: specs.lift_type },
    { label: "Mount type", value: specs.mount_type },
    { label: "Primary track size", value: specs.primary_track_size ?? machine.primary_track_size },
  ].filter((r) => r.value);

  const refs: OemRefRow[] = OEM_SLOTS.map((slot) => {
    const candidates = sortParts(dedupeBySku(slotCandidates(allParts, slot)));
    let oemNumber: string | null = null;
    let linkedSku: string | null = null;
    let price: number | null = null;
    let qtyAvailable: number | null = null;
    let status: OemRefRow["status"] = "none";

    for (const part of candidates) {
      const oem = oemNumberForPart(part);
      if (oem && !oemNumber) oemNumber = oem;
      if (hasCarriedListing(part)) {
        linkedSku = part.sku;
        price = part.price;
        qtyAvailable = part.qtyAvailable;
        status = isCarriedPart(part) ? "carried" : "carried";
        if (oem) oemNumber = oem;
        break;
      }
    }

    if (status === "none" && oemNumber) {
      status = "reference_only";
      const refPart = candidates.find((p) => oemNumberForPart(p) === oemNumber);
      if (refPart) linkedSku = refPart.sku;
    }

    return { label: slot.label, oemNumber, status, linkedSku, price, qtyAvailable };
  });

  return { specs: specRows, refs };
}

export function buildTracksTab(
  machine: PartsCounterMachine,
  trackParts: QaPart[],
  allParts: QaPart[],
  options: MachineTrackSizeOption[],
  includeSecondary: boolean,
  includeUnapproved: boolean,
): PartsCounterTrackGroup[] {
  return buildPartsCounterView(machine, trackParts, allParts, options, {
    includeSecondary,
    includeUnapproved,
    intent: "tracks",
  }).trackGroups;
}
