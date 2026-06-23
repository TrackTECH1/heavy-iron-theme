import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const EMBED_MODEL = "text-embedding-3-small";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

function normalizeTextHit(hit: Record<string, unknown>) {
  const handle = typeof hit.handle === "string" ? hit.handle : null;
  const label = [
    hit.make && hit.model ? `${hit.make} ${hit.model}` : "",
    hit.size,
    hit.tread,
  ].filter(Boolean).join(" · ") || String(hit.snippet || "Catalog match").slice(0, 90);

  return {
    id: [hit.source_type, handle, hit.size, hit.tread, hit.make, hit.model].filter(Boolean).join(":"),
    source_type: hit.source_type || null,
    label,
    track_size: hit.size || null,
    tread_pattern: hit.tread || null,
    make: hit.make || null,
    model: hit.model || null,
    price: hit.price ?? null,
    similarity: hit.rank ?? null,
    shopify_handle: handle,
    url: handle ? `/products/${handle}` : null,
    snippet: hit.snippet || null,
  };
}

function normalizeVectorHit(hit: Record<string, unknown>) {
  const metadata = (hit.metadata || {}) as Record<string, unknown>;
  const handle = typeof metadata.handle === "string" ? metadata.handle : null;
  const label = [
    metadata.track_size || metadata.size,
    metadata.tread_pattern || metadata.tread,
    metadata.make && metadata.model ? `${metadata.make} ${metadata.model}` : "",
  ].filter(Boolean).join(" · ") || String(hit.content || "Catalog match").slice(0, 90);

  return {
    id: hit.source_id || "",
    source_type: hit.source_type || null,
    label,
    track_size: metadata.track_size || metadata.size || null,
    tread_pattern: metadata.tread_pattern || metadata.tread || null,
    make: metadata.make || null,
    model: metadata.model || null,
    price: metadata.price || null,
    similarity: hit.similarity ?? null,
    shopify_handle: handle,
    url: handle ? `/products/${handle}` : null,
    snippet: hit.content || null,
  };
}

async function embed(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY) return null;
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) return null;
  const payload = await res.json();
  return payload?.data?.[0]?.embedding || null;
}

async function vectorSearch(query: string, limit: number, filter: Record<string, unknown>) {
  const vector = await embed(query);
  if (!vector) return [];
  const { data, error } = await supabase.rpc("match_catalog", {
    query_embedding: `[${vector.join(",")}]`,
    match_count: limit,
    filter,
  });
  if (error) return [];
  return (data || []).map(normalizeVectorHit);
}

async function textSearch(query: string, limit: number, filter: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("search_catalog_text", {
    q: query,
    match_count: limit,
    filter,
  });
  if (error) throw error;
  return (data || []).map(normalizeTextHit);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const query = String(body.q || body.query || "").trim();
    const limit = Math.min(Math.max(Number(body.limit || body.match_count || 8), 1), 12);
    const filter = body.filter && typeof body.filter === "object" ? body.filter : {};
    if (query.length < 2) return json({ error: "query is required" }, 400);

    const vectorResults = await vectorSearch(query, limit, filter);
    const results = vectorResults.length ? vectorResults : await textSearch(query, limit, filter);

    return json({
      query,
      results,
      matches: results,
      mode: vectorResults.length ? "vector" : "text",
    });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
});
