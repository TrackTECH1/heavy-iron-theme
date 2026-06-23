/** Lightweight size key normalize — mirrors scripts/lib/track_size_parser preprocess. */
export function normalizeTrackSizeKey(size: string | null | undefined): string {
  if (!size) return "";
  return size
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/×/g, "x")
    .replace(/(?<=\d)bx(?=\d)/g, "x")
    .replace(/(?<=\d)rubbertracks?(?=x|\d|$)/gi, "");
}

export function parseWidthMm(size: string | null | undefined): number {
  const n = normalizeTrackSizeKey(size).split("x")[0];
  const v = parseFloat(n);
  return Number.isFinite(v) ? v : 0;
}
