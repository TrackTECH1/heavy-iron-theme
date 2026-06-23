import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_ORIGIN = "https://heavyironsupply.com";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function response(body: unknown, status = 200, contentType = "application/ld+json; charset=utf-8") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": contentType },
  });
}

function text(value: unknown) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function property(name: string, value: unknown, unitCode?: string) {
  if (value === null || value === undefined || value === "") return null;
  return {
    "@type": "PropertyValue",
    name,
    value: String(value),
    ...(unitCode ? { unitCode } : {}),
  };
}

function availability(value: unknown) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("out") || normalized.includes("sold")) return "https://schema.org/OutOfStock";
  if (normalized.includes("pre")) return "https://schema.org/PreOrder";
  return "https://schema.org/InStock";
}

async function firstProduct(url: URL) {
  const handle = url.searchParams.get("handle");
  const sku = url.searchParams.get("sku");
  const id = url.searchParams.get("id");

  let query = supabase
    .from("product")
    .select("id, product_code, sku, mpn, part_number, oem_part_number, gtin, title, handle, part_type, type, track_size, width_mm, pitch_mm, links, guide_type, tread_pattern, price, base_price, availability, image_url, image_alt, seo")
    .limit(1);

  if (handle) query = query.eq("handle", handle);
  else if (sku) query = query.or(`sku.eq.${sku},product_code.eq.${sku},mpn.eq.${sku}`);
  else if (id) query = query.eq("id", id);
  else query = query.not("handle", "is", null).order("updated_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data?.[0] || null;
}

async function productFitments(productId: string) {
  const { data: rows, error } = await supabase
    .from("fitment")
    .select("machine_id")
    .eq("product_id", productId)
    .limit(40);

  if (error) return [];
  const ids = [...new Set((rows || []).map((row) => row.machine_id).filter(Boolean))];
  if (!ids.length) return [];

  const { data: machines, error: machineError } = await supabase
    .from("machine")
    .select("make, model, model_key, machine_type_code")
    .in("id", ids)
    .limit(40);

  if (machineError) return [];
  return machines || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return response({ error: "method_not_allowed" }, 405, "application/json; charset=utf-8");

  try {
    const url = new URL(req.url);
    const product = await firstProduct(url);
    if (!product) return response({ error: "product_not_found" }, 404, "application/json; charset=utf-8");

    const fitments = await productFitments(product.id);
    const productUrl = product.handle ? `${SITE_ORIGIN}/products/${product.handle}` : SITE_ORIGIN;
    const compatibleModels = fitments.map((machine) => `${machine.make} ${machine.model}`);

    return response({
      "@context": "https://schema.org",
      "@type": "Product",
      "@id": `${productUrl}#product`,
      name: text(product.title),
      url: productUrl,
      image: product.image_url ? [product.image_url] : undefined,
      description: text(product.seo?.description || product.image_alt || product.title),
      brand: { "@type": "Brand", name: "Heavy Iron Supply Co." },
      sku: product.sku || product.product_code,
      mpn: product.mpn || product.part_number || product.oem_part_number || product.sku,
      gtin: product.gtin || undefined,
      category: product.part_type || product.type || "Heavy Machinery Parts",
      offers: {
        "@type": "Offer",
        url: productUrl,
        priceCurrency: "USD",
        price: String(product.base_price || product.price || ""),
        priceValidUntil: "2027-12-31",
        itemCondition: "https://schema.org/NewCondition",
        availability: availability(product.availability),
        shippingDetails: {
          "@type": "OfferShippingDetails",
          shippingRate: { "@type": "MonetaryAmount", value: "0.00", currency: "USD" },
          shippingDestination: { "@type": "DefinedRegion", addressCountry: "US" },
          deliveryTime: {
            "@type": "ShippingDeliveryTime",
            handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "d" },
            transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 3, unitCode: "d" },
          },
        },
      },
      isAccessoryOrSparePartFor: fitments.map((machine) => ({
        "@type": "ProductModel",
        name: `${machine.make} ${machine.model}`,
        manufacturer: { "@type": "Organization", name: machine.make },
        url: `${SITE_ORIGIN}/pages/machines/${machine.model_key}`,
      })),
      additionalProperty: [
        property("Track Size", product.track_size),
        property("Track Width", product.width_mm, "MMT"),
        property("Pitch", product.pitch_mm, "MMT"),
        property("Link Count", product.links),
        property("Guide Type", product.guide_type),
        property("Tread Pattern", product.tread_pattern),
        property("Compatible Models", compatibleModels.join(", ")),
      ].filter(Boolean),
    });
  } catch (error) {
    return response({ error: String(error) }, 500, "application/json; charset=utf-8");
  }
});
