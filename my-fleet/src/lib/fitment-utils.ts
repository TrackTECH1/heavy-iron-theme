import type { QaPart } from "./qa-types";
import { classifySkuTier } from "./track-product-filters";

export function extractPartNumber(title: string | null): string | null {
  if (!title) return null;
  const hash = title.match(/(?:Part\s*#|Part\s*No\.?|P\/N:?|#)\s*([A-Za-z0-9][\w/.-]+)/i);
  if (hash) return hash[1];
  const slash = title.match(/\|\s*Part\s*#?\s*([\w/.-]+)/i);
  if (slash) return slash[1];
  return null;
}

export function extractOemFromSku(sku: string): string | null {
  const u = sku.trim().toUpperCase();
  const prefix = u.match(/^(?:SP|FI|RR|TR|CR|ID|BR)([A-Z0-9][\w.-]+)$/);
  if (prefix) return prefix[1];
  return null;
}

export function oemNumberForPart(part: QaPart): string | null {
  return extractPartNumber(part.title) ?? extractOemFromSku(part.sku);
}

export function rankPart(part: QaPart): number {
  const tier = classifySkuTier(part.sku);
  const tierRank = tier === "primary" ? 0 : tier === "secondary" ? 1 : 2;
  const stockRank = (part.qtyAvailable ?? 0) > 0 ? 0 : 1;
  const fitmentRank =
    part.fitmentType === "explicit_supplier_fitment" && part.fitmentConfidence === "supplier"
      ? 0
      : part.fitmentType === "explicit_supplier_fitment"
        ? 1
        : 2;
  const priceRank = part.price != null ? 0 : 1;
  return tierRank * 1000 + stockRank * 100 + fitmentRank * 10 + priceRank;
}

export function sortParts(parts: QaPart[]): QaPart[] {
  return [...parts].sort((a, b) => {
    const diff = rankPart(a) - rankPart(b);
    if (diff !== 0) return diff;
    return a.sku.localeCompare(b.sku);
  });
}

export function isPlaceholderPart(part: QaPart): boolean {
  const sku = part.sku.toUpperCase();
  if (sku.includes("PLACEHOLDER") || sku.startsWith("XXX")) return true;
  if (!part.title?.trim()) return true;
  if (part.title.toLowerCase().includes("placeholder")) return true;
  return false;
}

export function partPassesTierFilter(part: QaPart, includeSecondary: boolean): boolean {
  if (isPlaceholderPart(part)) return includeSecondary;
  const tier = classifySkuTier(part.sku);
  if (tier === "primary") return true;
  return includeSecondary;
}

export function isCarriedPart(part: QaPart): boolean {
  if (isPlaceholderPart(part)) return false;
  const tier = classifySkuTier(part.sku);
  return tier === "primary" && (part.qtyAvailable ?? 0) > 0;
}

export function hasCarriedListing(part: QaPart): boolean {
  if (isPlaceholderPart(part)) return false;
  return classifySkuTier(part.sku) === "primary";
}
