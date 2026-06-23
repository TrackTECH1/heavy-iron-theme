export type SkuTier = "primary" | "secondary" | "other";

export function classifySkuTier(sku: string): SkuTier {
  const u = sku.trim().toUpperCase();
  if (u.startsWith("TNT")) return "primary";
  if (u.startsWith("BS")) return "secondary";
  if (u.startsWith("TT-") || u.startsWith("TT")) return "secondary";
  return "other";
}

export function isDefaultRecommendedSku(sku: string): boolean {
  return classifySkuTier(sku) === "primary";
}
