import type { QaCategory } from "./qa-types";
import { normalizeTrackSizeKey } from "./track-size-normalize";

export type FleetMediaRow = {
  track_size_id?: string;
  canonical_size?: string;
  tread_pattern?: string | null;
  display_priority?: number;
  sku?: string;
  url: string;
  role?: string | null;
};

export type MediaContext = {
  machineHeroUrl: string | null;
  trackSizeById: Map<string, FleetMediaRow[]>;
  trackSizeByKey: Map<string, string>;
  productBySku: Map<string, string>;
};

export function buildMediaContext(opts: {
  machineHeroUrl: string | null;
  trackRows: FleetMediaRow[];
  productRows: FleetMediaRow[];
}): MediaContext {
  const trackSizeById = new Map<string, FleetMediaRow[]>();
  const trackSizeByKey = new Map<string, string>();

  for (const row of opts.trackRows) {
    if (!row.track_size_id) continue;
    const list = trackSizeById.get(row.track_size_id) ?? [];
    list.push(row);
    trackSizeById.set(row.track_size_id, list);
    if (row.canonical_size) {
      trackSizeByKey.set(normalizeTrackSizeKey(row.canonical_size), row.url);
    }
  }

  for (const [id, rows] of trackSizeById) {
    rows.sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99));
    trackSizeById.set(id, rows);
    const hero = rows.find((r) => r.role === "hero") ?? rows[0];
    if (hero?.canonical_size) {
      trackSizeByKey.set(normalizeTrackSizeKey(hero.canonical_size), hero.url);
    }
    void id;
  }

  const productBySku = new Map<string, string>();
  for (const row of opts.productRows) {
    if (row.sku) productBySku.set(row.sku, row.url);
  }

  return {
    machineHeroUrl: opts.machineHeroUrl,
    trackSizeById,
    trackSizeByKey,
    productBySku,
  };
}

function treadMatches(rowTread: string | null | undefined, treadLabel: string | null | undefined): boolean {
  if (!treadLabel || !rowTread) return !treadLabel && !rowTread;
  return rowTread.toLowerCase() === treadLabel.toLowerCase();
}

export function resolveTrackSizeImage(
  ctx: MediaContext,
  trackSizeId: string | null | undefined,
  canonicalSize: string | null | undefined,
  treadLabel?: string | null,
): string | null {
  if (trackSizeId) {
    const rows = ctx.trackSizeById.get(trackSizeId);
    if (rows?.length) {
      const treadMatch = treadLabel
        ? rows.find((r) => treadMatches(r.tread_pattern, treadLabel))
        : null;
      return (treadMatch ?? rows.find((r) => r.role === "hero") ?? rows[0]).url;
    }
  }
  if (canonicalSize) {
    return ctx.trackSizeByKey.get(normalizeTrackSizeKey(canonicalSize)) ?? null;
  }
  return null;
}

export function resolveProductImage(
  ctx: MediaContext,
  opts: {
    sku: string;
    category: QaCategory;
    trackSizeId?: string | null;
    trackSize?: string | null;
    treadLabel?: string | null;
  },
): string | null {
  const skuImage = ctx.productBySku.get(opts.sku);
  if (skuImage) return skuImage;

  if (opts.category !== "Rubber Tracks") return null;

  return resolveTrackSizeImage(ctx, opts.trackSizeId, opts.trackSize, opts.treadLabel);
}

export function applyMediaToParts<T extends { sku: string; category: QaCategory; trackSize?: string | null; treadLabel?: string | null; imageUrl?: string | null }>(
  parts: T[],
  ctx: MediaContext,
  trackSizeIdByKey: Map<string, string>,
): T[] {
  return parts.map((part) => {
    const trackSizeId = part.trackSize
      ? trackSizeIdByKey.get(normalizeTrackSizeKey(part.trackSize))
      : null;
    const resolved = resolveProductImage(ctx, {
      sku: part.sku,
      category: part.category,
      trackSizeId,
      trackSize: part.trackSize,
      treadLabel: part.treadLabel,
    });
    return { ...part, imageUrl: resolved ?? part.imageUrl ?? null };
  });
}
