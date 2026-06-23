import type { QaCategory, QaIntent, QaPart } from "./qa-types";
import type { MediaContext } from "./media-resolver";
import { resolveProductImage, resolveTrackSizeImage } from "./media-resolver";
import type { MachineTrackSizeOption } from "./track-size-options";
import { normalizeTrackSizeKey } from "./track-size-normalize";
import { isApprovedTrackSize, sortTrackSizeOptions } from "./track-size-options";
import {
  extractPartNumber,
  partPassesTierFilter,
  rankPart,
} from "./fitment-utils";

export const STANDARD_TREAD_ORDER = [
  "C-Block",
  "Zig-Zag",
  "Multi-Bar",
  "X-Terrain",
] as const;

export type PartsCounterTrackGroup = {
  title: string;
  trackSize: string;
  trackSizeId: string | null;
  widthLabel: "wide" | "narrow" | "standard" | null;
  imageUrl: string | null;
  variants: TrackTreadVariant[];
};

export type TrackTreadVariant = {
  treadLabel: string;
  trackSize: string;
  detailLine: string;
  sku: string;
  price: number | null;
  qtyAvailable: number | null;
  imageUrl: string | null;
};

export type PartsCounterUndercarriageRow = {
  partType: string;
  label: string;
  partNumber: string | null;
  sku: string;
  price: number | null;
  qtyAvailable: number | null;
};

export type PartsCounterMachine = {
  machine_id: string;
  brand: string;
  model: string;
  machine_type: string | null;
  primary_track_size: string | null;
  horsepower?: number | null;
  operating_weight_lbs?: number | null;
  std_gpm?: number | null;
  std_psi?: number | null;
  lift_type?: string | null;
  mount_type?: string | null;
};

export type PartsCounterView = {
  machine: PartsCounterMachine;
  trackGroups: PartsCounterTrackGroup[];
  undercarriage: PartsCounterUndercarriageRow[];
  machineHeroUrl?: string | null;
};

const UNDERCARRIAGE_ORDER: {
  category: QaCategory;
  partType: string;
  label: string;
}[] = [
  { category: "Sprockets", partType: "Sprocket", label: "Sprocket" },
  { category: "Front Idlers", partType: "Front Idler", label: "Front Idler" },
  { category: "Rear Idlers", partType: "Rear Idler", label: "Rear Idler" },
  { category: "Bottom Rollers", partType: "Bottom Roller", label: "Bottom Roller" },
  { category: "Top Rollers", partType: "Top Roller", label: "Top Roller" },
  { category: "Undercarriage Kits", partType: "Undercarriage Kit", label: "Kit" },
];

function pickBestPart(parts: QaPart[]): QaPart | null {
  if (parts.length === 0) return null;
  return [...parts].sort((a, b) => rankPart(a) - rankPart(b))[0];
}

function treadSortKey(label: string): number {
  const idx = STANDARD_TREAD_ORDER.indexOf(label as (typeof STANDARD_TREAD_ORDER)[number]);
  return idx >= 0 ? idx : STANDARD_TREAD_ORDER.length + 1;
}

function partsForTrackSize(
  trackParts: QaPart[],
  canonicalSize: string,
  options: MachineTrackSizeOption[],
  includeUnapproved: boolean,
): QaPart[] {
  const key = normalizeTrackSizeKey(canonicalSize);
  return trackParts.filter((p) => {
    if (normalizeTrackSizeKey(p.trackSize) !== key) return false;
    if (!includeUnapproved && !isApprovedTrackSize(p.trackSize, options)) return false;
    return true;
  });
}

function buildTrackGroup(
  machine: PartsCounterMachine,
  option: MachineTrackSizeOption,
  trackParts: QaPart[],
  options: MachineTrackSizeOption[],
  includeSecondary: boolean,
  includeUnapproved: boolean,
  media?: MediaContext | null,
): PartsCounterTrackGroup | null {
  const sized = partsForTrackSize(trackParts, option.canonical_size, options, includeUnapproved)
    .filter((p) => partPassesTierFilter(p, includeSecondary));

  const byTread = new Map<string, QaPart[]>();
  for (const part of sized) {
    const label = part.treadLabel ?? "Other";
    const list = byTread.get(label) ?? [];
    list.push(part);
    byTread.set(label, list);
  }

  const variants: TrackTreadVariant[] = [];
  for (const [treadLabel, candidates] of byTread) {
    const best = pickBestPart(candidates);
    if (!best) continue;
    variants.push({
      treadLabel,
      trackSize: option.canonical_size,
      detailLine: `${option.canonical_size} · ${treadLabel}`,
      sku: best.sku,
      price: best.price,
      qtyAvailable: best.qtyAvailable,
      imageUrl: media
        ? resolveProductImage(media, {
            sku: best.sku,
            category: "Rubber Tracks",
            trackSizeId: option.track_size_id,
            trackSize: option.canonical_size,
            treadLabel,
          })
        : null,
    });
  }

  variants.sort((a, b) => treadSortKey(a.treadLabel) - treadSortKey(b.treadLabel));

  if (variants.length === 0) return null;

  const widthSuffix =
    option.option_label === "wide"
      ? " (Wide)"
      : option.option_label === "narrow"
        ? " (Narrow)"
        : option.option_label === "alternate"
          ? ""
          : "";

  return {
    title: `${machine.brand} ${machine.model} Rubber Tracks | ${option.canonical_size}${widthSuffix}`,
    trackSize: option.canonical_size,
    trackSizeId: option.track_size_id,
    widthLabel:
      option.option_label === "wide" || option.option_label === "narrow"
        ? option.option_label
        : option.option_label === "standard"
          ? "standard"
          : null,
    imageUrl: media
      ? resolveTrackSizeImage(media, option.track_size_id, option.canonical_size)
      : null,
    variants,
  };
}

function intentShowsTracks(intent: QaIntent): boolean {
  return ["general", "tracks", "tread_options", "undercarriage"].includes(intent);
}

function intentShowsUndercarriage(intent: QaIntent): boolean {
  return ["general", "undercarriage", "sprockets", "idlers", "rollers", "kits"].includes(intent);
}

function undercarriageMatchesIntent(row: PartsCounterUndercarriageRow, intent: QaIntent): boolean {
  if (intent === "general" || intent === "undercarriage") return true;
  if (intent === "sprockets") return row.partType === "Sprocket";
  if (intent === "idlers")
    return row.partType === "Front Idler" || row.partType === "Rear Idler";
  if (intent === "rollers")
    return row.partType === "Bottom Roller" || row.partType === "Top Roller";
  if (intent === "kits") return row.partType === "Undercarriage Kit";
  return false;
}

export function buildPartsCounterView(
  machine: PartsCounterMachine,
  trackParts: QaPart[],
  allParts: QaPart[],
  options: MachineTrackSizeOption[],
  opts?: {
    includeSecondary?: boolean;
    includeUnapproved?: boolean;
    intent?: QaIntent;
    media?: MediaContext | null;
    machineHeroUrl?: string | null;
  },
): PartsCounterView {
  const includeSecondary = opts?.includeSecondary ?? false;
  const includeUnapproved = opts?.includeUnapproved ?? false;
  const intent = opts?.intent ?? "general";
  const media = opts?.media ?? null;
  const machineHeroUrl = opts?.machineHeroUrl ?? media?.machineHeroUrl ?? null;

  const trackGroups: PartsCounterTrackGroup[] = [];

  if (intentShowsTracks(intent)) {
    const sizeOptions = sortTrackSizeOptions(
      options.filter((o) => o.approval_status === "approved" || includeUnapproved),
    );

    for (const option of sizeOptions) {
      const group = buildTrackGroup(
        machine,
        option,
        trackParts,
        options,
        includeSecondary,
        includeUnapproved,
        media,
      );
      if (group) trackGroups.push(group);
    }
  }

  const undercarriage: PartsCounterUndercarriageRow[] = [];

  if (intentShowsUndercarriage(intent)) {
    const nonTrack = allParts.filter((p) => p.category !== "Rubber Tracks");

    for (const slot of UNDERCARRIAGE_ORDER) {
      const candidates = nonTrack
        .filter((p) => p.category === slot.category || p.partType === slot.partType)
        .filter((p) => partPassesTierFilter(p, includeSecondary));

      const best = pickBestPart(candidates);
      if (!best) continue;

      const partNumber = extractPartNumber(best.title);
      const row: PartsCounterUndercarriageRow = {
        partType: slot.partType,
        label: `${machine.brand} ${machine.model} ${slot.label}${partNumber ? ` | Part #${partNumber}` : ""}`,
        partNumber,
        sku: best.sku,
        price: best.price,
        qtyAvailable: best.qtyAvailable,
      };

      if (undercarriageMatchesIntent(row, intent)) {
        undercarriage.push(row);
      }
    }
  }

  return { machine, trackGroups, undercarriage, machineHeroUrl };
}
