import type { FleetMachine } from "./types";
import type { QaPartRow } from "./qa-types";
import { normalizeTrackSizeKey, parseWidthMm } from "./track-size-normalize";

export type TrackOptionLabel = "wide" | "narrow" | "standard" | "alternate";
export type ApprovalStatus = "approved" | "primary_only" | "review";

export type MachineTrackSizeOption = {
  machine_id: string;
  track_size_id: string | null;
  canonical_size: string;
  option_label: TrackOptionLabel;
  display_priority: number;
  is_default_recommended: boolean;
  source: string;
  approval_status: ApprovalStatus;
};

type SizeCandidate = {
  canonical_size: string;
  track_size_id: string | null;
  source: string;
  width_mm: number;
};

function canonicalDisplaySize(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, "")
    .replace(/×/g, "x")
    .replace(/(?<=\d)[Bb]x(?=\d)/g, "x");
}

function addCandidate(
  map: Map<string, SizeCandidate>,
  rawSize: string | null | undefined,
  trackSizeId: string | null | undefined,
  source: string,
) {
  if (!rawSize?.trim()) return;
  const key = normalizeTrackSizeKey(rawSize);
  if (!key) return;
  const existing = map.get(key);
  const width = parseWidthMm(rawSize);
  const next: SizeCandidate = {
    canonical_size: canonicalDisplaySize(rawSize),
    track_size_id: trackSizeId ?? existing?.track_size_id ?? null,
    source: existing ? `${existing.source}|${source}` : source,
    width_mm: width,
  };
  if (!existing) {
    map.set(key, next);
    return;
  }
  const preferNext =
    (existing.canonical_size.includes("Bx") || existing.canonical_size.includes("bx")) &&
    !next.canonical_size.includes("Bx") &&
    !next.canonical_size.includes("bx");
  const preferExistingPrimary =
    existing.source.includes("primary") && !source.includes("primary");
  if (preferNext || !preferExistingPrimary) {
    map.set(key, next);
  }
}

export function buildMachineTrackSizeOptions(
  machine: FleetMachine,
  rows: QaPartRow[],
): MachineTrackSizeOption[] {
  const candidates = new Map<string, SizeCandidate>();

  addCandidate(
    candidates,
    machine.primary_track_size,
    machine.track_size_id,
    "primary",
  );

  for (const row of rows) {
    if (
      row.fitment_type === "explicit_supplier_fitment" &&
      row.confidence === "supplier" &&
      (row.product_type ?? "").includes("Track")
    ) {
      addCandidate(
        candidates,
        row.product_track_size,
        row.product_track_size_id,
        "supplier_fitment",
      );
    }
  }

  const sizes = [...candidates.values()].sort((a, b) => b.width_mm - a.width_mm);
  if (sizes.length === 0) return [];

  const widest = sizes[0];
  const narrowest = sizes[sizes.length - 1];
  const hasWideNarrowPair = sizes.length >= 2 && widest.width_mm > narrowest.width_mm;

  return sortTrackSizeOptions(
    sizes.map((s) => {
    let option_label: TrackOptionLabel;
    let display_priority: number;

    if (!hasWideNarrowPair) {
      option_label = "standard";
      display_priority = 1;
    } else if (s.canonical_size === widest.canonical_size || normalizeTrackSizeKey(s.canonical_size) === normalizeTrackSizeKey(widest.canonical_size)) {
      option_label = "wide";
      display_priority = 1;
    } else if (
      s.canonical_size === narrowest.canonical_size ||
      normalizeTrackSizeKey(s.canonical_size) === normalizeTrackSizeKey(narrowest.canonical_size)
    ) {
      option_label = "narrow";
      display_priority = 3;
    } else {
      option_label = "alternate";
      display_priority = 2;
    }

    const is_default_recommended =
      option_label === "wide" || (!hasWideNarrowPair && option_label === "standard");

    return {
      machine_id: machine.machine_id,
      track_size_id: s.track_size_id,
      canonical_size: s.canonical_size,
      option_label,
      display_priority,
      is_default_recommended,
      source: s.source,
      approval_status: "approved" as ApprovalStatus,
    };
    }),
  );
}

/** Wide first, then mid alternates (e.g. 380 after 400), then narrow. */
export function sortTrackSizeOptions(
  options: MachineTrackSizeOption[],
): MachineTrackSizeOption[] {
  return [...options].sort((a, b) => {
    if (a.display_priority !== b.display_priority) {
      return a.display_priority - b.display_priority;
    }
    return parseWidthMm(b.canonical_size) - parseWidthMm(a.canonical_size);
  });
}

/** Track-finder approved sizes only — no supplier/QA inference fallback. */
export function finalizeMachineTrackSizeOptions(
  dbOptions: MachineTrackSizeOption[],
): MachineTrackSizeOption[] {
  return sortTrackSizeOptions(dbOptions);
}

/** Collapse Bx/x duplicates from DB view or merged sources. */
export function dedupeMachineTrackSizeOptions(
  options: MachineTrackSizeOption[],
): MachineTrackSizeOption[] {
  const byKey = new Map<string, MachineTrackSizeOption>();
  for (const o of options) {
    const key = normalizeTrackSizeKey(o.canonical_size);
    const existing = byKey.get(key);
    const next = {
      ...o,
      canonical_size: canonicalDisplaySize(o.canonical_size),
    };
    if (!existing) {
      byKey.set(key, next);
      continue;
    }
    const preferNext =
      (existing.canonical_size.includes("Bx") || existing.canonical_size.includes("bx")) &&
      !next.canonical_size.includes("Bx");
    const merged: MachineTrackSizeOption = preferNext
      ? { ...next, source: `${existing.source}|${next.source}` }
      : { ...existing, source: `${existing.source}|${next.source}` };
    byKey.set(key, merged);
  }
  return sortTrackSizeOptions([...byKey.values()]);
}

export type TrackWidthGroup =
  | "Wide Tracks"
  | "Alternate Tracks"
  | "Narrow Tracks"
  | "Other / Review";

export function trackGroupNameForOption(
  option: MachineTrackSizeOption,
): TrackWidthGroup {
  if (option.option_label === "wide" || option.option_label === "standard") {
    return "Wide Tracks";
  }
  if (option.option_label === "alternate") return "Alternate Tracks";
  if (option.option_label === "narrow") return "Narrow Tracks";
  return "Other / Review";
}

export function trackWidthGroupForSize(
  productTrackSize: string | null | undefined,
  options: MachineTrackSizeOption[],
): TrackWidthGroup {
  const key = normalizeTrackSizeKey(productTrackSize);
  if (!key) return "Other / Review";

  const match = options.find((o) => normalizeTrackSizeKey(o.canonical_size) === key);
  if (!match || match.approval_status !== "approved") return "Other / Review";

  return trackGroupNameForOption(match);
}

export function isApprovedTrackSize(
  productTrackSize: string | null | undefined,
  options: MachineTrackSizeOption[],
): boolean {
  const key = normalizeTrackSizeKey(productTrackSize);
  return options.some(
    (o) =>
      o.approval_status === "approved" &&
      normalizeTrackSizeKey(o.canonical_size) === key,
  );
}
