import type { QaPart, QaTrackGroup } from "./qa-types";
import type { MachineTrackSizeOption } from "./track-size-options";
import {
  isApprovedTrackSize,
  sortTrackSizeOptions,
  trackGroupNameForOption,
} from "./track-size-options";
import { normalizeTrackSizeKey } from "./track-size-normalize";
import { classifySkuTier } from "./track-product-filters";

export function buildTrackGroups(
  trackParts: QaPart[],
  options: MachineTrackSizeOption[],
  opts?: { includeSecondary?: boolean; includeUnapproved?: boolean },
): QaTrackGroup[] {
  const includeSecondary = opts?.includeSecondary ?? false;
  const includeUnapproved = opts?.includeUnapproved ?? false;

  const groups: QaTrackGroup[] = [];
  const assigned = new Set<string>();

  const sizeOptions = sortTrackSizeOptions(
    options.filter((o) => o.approval_status === "approved" || includeUnapproved),
  );

  for (const option of sizeOptions) {
    const sizeKey = normalizeTrackSizeKey(option.canonical_size);
    const parts = trackParts.filter((p) => {
      if (normalizeTrackSizeKey(p.trackSize) !== sizeKey) return false;
      if (!includeSecondary && classifySkuTier(p.sku) === "secondary") return false;
      return true;
    });

    if (parts.length === 0) continue;
    for (const p of parts) assigned.add(p.sku);

    groups.push({
      name: trackGroupNameForOption(option),
      trackSizeLabel: option.canonical_size,
      parts: parts.sort((a, b) => a.sku.localeCompare(b.sku)),
    });
  }

  const reviewParts = trackParts.filter((p) => {
    if (assigned.has(p.sku)) return false;
    if (!includeUnapproved) return false;
    if (!includeSecondary && classifySkuTier(p.sku) === "secondary") return false;
    return !isApprovedTrackSize(p.trackSize, options);
  });

  if (reviewParts.length > 0) {
    groups.push({
      name: "Other / Review",
      trackSizeLabel: null,
      parts: reviewParts.sort((a, b) => a.sku.localeCompare(b.sku)),
    });
  }

  return groups;
}
