import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EntityType,
  GeneratePostResult,
  ImageOption,
} from "@/lib/content-studio/types";
import { shopifyStoreBase } from "@/lib/meta/config";

function productShopifyUrl(sku: string) {
  const base = shopifyStoreBase();
  return `${base}/products/${encodeURIComponent(sku.toLowerCase())}`;
}

function machineShopifyUrl(brand: string, model: string) {
  const base = shopifyStoreBase();
  const q = encodeURIComponent(`${brand} ${model}`.trim());
  return `${base}/search?q=${q}&type=product`;
}

function trackSizeShopifyUrl(canonicalSize: string) {
  const base = shopifyStoreBase();
  const q = encodeURIComponent(canonicalSize);
  return `${base}/search?q=${q}&type=product`;
}

async function loadMachineImages(
  supabase: SupabaseClient,
  machineId: string,
): Promise<ImageOption[]> {
  const { data } = await supabase
    .from("fleet_model_hero")
    .select("url, media_id, alt_text")
    .eq("machine_id", machineId)
    .not("url", "is", null);
  return (data ?? []).map((r) => ({
    url: r.url as string,
    media_id: (r.media_id as string) ?? null,
    label: (r.alt_text as string) || "Machine hero",
    role: "hero",
  }));
}

async function loadTrackSizeImages(
  supabase: SupabaseClient,
  trackSizeId: string,
): Promise<ImageOption[]> {
  const { data } = await supabase
    .from("fleet_track_size_media")
    .select("url, media_id, role, tread_pattern, alt_text")
    .eq("track_size_id", trackSizeId)
    .not("url", "is", null)
    .order("display_priority", { ascending: true })
    .limit(20);
  return (data ?? []).map((r) => ({
    url: r.url as string,
    media_id: (r.media_id as string) ?? null,
    label: [r.tread_pattern, r.role].filter(Boolean).join(" · ") || "Track image",
    role: r.role as string,
  }));
}

async function loadProductImages(
  supabase: SupabaseClient,
  sku: string,
): Promise<{ images: ImageOption[]; productId: string | null; trackSizeId: string | null }> {
  const { data: products } = await supabase
    .from("fleet_products")
    .select("product_id, sku, track_size_id")
    .eq("sku", sku)
    .limit(1);
  const product = products?.[0];

  const { data: media } = await supabase
    .from("fleet_product_media")
    .select("url, media_id, role, alt_text")
    .eq("sku", sku)
    .not("url", "is", null)
    .limit(10);

  const images: ImageOption[] = (media ?? []).map((r) => ({
    url: r.url as string,
    media_id: (r.media_id as string) ?? null,
    label: (r.alt_text as string) || (r.role as string) || "Product image",
    role: r.role as string,
  }));

  if (images.length === 0 && product?.track_size_id) {
    const inherited = await loadTrackSizeImages(supabase, product.track_size_id as string);
    images.push(...inherited.slice(0, 4));
  }

  return {
    images,
    productId: (product?.product_id as string) ?? null,
    trackSizeId: (product?.track_size_id as string) ?? null,
  };
}

export async function generatePostFromEntity(
  supabase: SupabaseClient,
  entityType: EntityType,
  entityId: string,
): Promise<GeneratePostResult> {
  const store = shopifyStoreBase();

  if (entityType === "machine") {
    const { data: machine, error } = await supabase
      .from("fleet_machine_catalog")
      .select("machine_id, brand, model")
      .eq("machine_id", entityId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!machine) throw new Error(`Machine not found: ${entityId}`);

    const label = `${machine.brand} ${machine.model}`;
    const imageOptions = await loadMachineImages(supabase, entityId);
    const shopifyUrl = machineShopifyUrl(machine.brand as string, machine.model as string);
    const caption = `Guaranteed-fit rubber tracks for your ${label}. Shop TrackTECH — built for contractors who can't afford downtime.\n\n${shopifyUrl}`;

    return {
      entity_type: "machine",
      entity_id: entityId,
      entity_label: label,
      headline: `${label} — Rubber Track Fitment`,
      body: `We stock rubber tracks sized and tested for the ${label}. Use My Fleet to confirm your exact track size and tread before you order.`,
      caption,
      shopify_url: shopifyUrl,
      image_options: imageOptions,
      suggested_image_url: imageOptions[0]?.url ?? null,
    };
  }

  if (entityType === "track_size") {
    const { data: ts, error } = await supabase
      .from("fleet_track_size_spine")
      .select("track_size_id, canonical_size")
      .eq("track_size_id", entityId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ts) throw new Error(`Track size not found: ${entityId}`);

    const label = ts.canonical_size as string;
    const imageOptions = await loadTrackSizeImages(supabase, entityId);
    const shopifyUrl = trackSizeShopifyUrl(label);
    const caption = `${label} rubber tracks — multiple tread patterns available. Heavy-duty construction. Fast shipping.\n\n${shopifyUrl}`;

    return {
      entity_type: "track_size",
      entity_id: entityId,
      entity_label: label,
      headline: `${label} Rubber Tracks`,
      body: `Browse ${label} options with clear tread photos and guaranteed fitment data from our clean catalog spine.`,
      caption,
      shopify_url: shopifyUrl,
      image_options: imageOptions,
      suggested_image_url: imageOptions.find((i) => i.role === "hero")?.url ?? imageOptions[0]?.url ?? null,
    };
  }

  const sku = entityId.trim().toUpperCase();
  const { images, productId } = await loadProductImages(supabase, sku);
  if (!productId && images.length === 0) {
    throw new Error(`Product/SKU not found in fleet catalog: ${sku}`);
  }

  const shopifyUrl = productShopifyUrl(sku);
  const caption = `${sku} — premium rubber track. Verified fitment data on TrackTECH My Fleet.\n\n${shopifyUrl}`;

  return {
    entity_type: "product",
    entity_id: sku,
    entity_label: sku,
    headline: `${sku} Rubber Track`,
    body: `Order ${sku} with confidence. Product card uses approved catalog imagery and Shopify as the purchase destination (${store}).`,
    caption,
    shopify_url: shopifyUrl,
    image_options: images,
    suggested_image_url: images[0]?.url ?? null,
  };
}
