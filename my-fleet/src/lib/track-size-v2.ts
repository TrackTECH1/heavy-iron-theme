import type { QaPartRow } from "./qa-types";

/** True when canonical size is a valid v2 spine entry (≤3 chunks, no RUBBERTRACK). */
export function isV2CanonicalSize(size: string | null | undefined): boolean {
  if (!size?.trim()) return false;
  const s = size.trim();
  if (/rubbertrack/i.test(s)) return false;
  const chunks = s.toLowerCase().split("x").filter(Boolean);
  return chunks.length > 0 && chunks.length <= 3;
}

export function chunkCount(size: string | null | undefined): number {
  if (!size?.trim()) return 0;
  return size.trim().toLowerCase().split("x").filter(Boolean).length;
}

/** Drop legacy track rows missing v2 product_track_size or polluted canonical strings. */
export function filterV2QaParts(rows: QaPartRow[]): QaPartRow[] {
  return rows.filter((row) => {
    const isTrack =
      (row.product_type ?? "").includes("Track") || row.product_type === "Track Pads";
    if (!isTrack) return true;
    if (!isV2CanonicalSize(row.product_track_size)) return false;
    if (!row.product_track_size_id) return false;
    return true;
  });
}
