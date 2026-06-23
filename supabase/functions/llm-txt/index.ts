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

function clean(value: unknown) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function line(cells: unknown[]) {
  return `| ${cells.map(clean).join(" | ")} |`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
    });
  }

  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 1000), 1), 5000);
    const format = String(url.searchParams.get("format") || "text").toLowerCase();

    const { data: products, error } = await supabase
      .from("product")
      .select("sku, product_code, title, handle, part_type, type, track_size, width_mm, pitch_mm, links, guide_type, tread_pattern, price, base_price, availability")
      .not("handle", "is", null)
      .limit(limit);

    if (error) throw error;

    const rows = products || [];
    if (format === "json") {
      return new Response(JSON.stringify({ source: "supabase", count: rows.length, products: rows }), {
        headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
      });
    }

    const body = [
      "# Heavy Iron Supply Co. Machine-Readable Catalog",
      "",
      "Source of truth: Supabase Postgres. Storefront checkout: Shopify.",
      "Free fast LTL freight: lower 48 United States, 1-3 business day transit target.",
      "",
      line(["SKU", "Title", "Type", "Track Size", "Width MM", "Pitch MM", "Links", "Guide", "Tread", "Price USD", "Availability", "URL"]),
      line(["---", "---", "---", "---", "---", "---", "---", "---", "---", "---", "---", "---"]),
      ...rows.map((product) => line([
        product.sku || product.product_code,
        product.title,
        product.part_type || product.type,
        product.track_size,
        product.width_mm,
        product.pitch_mm,
        product.links,
        product.guide_type,
        product.tread_pattern,
        product.base_price || product.price,
        product.availability,
        product.handle ? `${SITE_ORIGIN}/products/${product.handle}` : "",
      ])),
      "",
    ].join("\n");

    return new Response(body, {
      headers: { ...CORS, "content-type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
    });
  }
});
