import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MODEL = "text-embedding-3-small";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

function stripHtml(value: unknown): string {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function md(value: unknown): string {
  return stripHtml(value).replace(/[|]/g, "\\|").replace(/\r?\n/g, " ").slice(0, 420);
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const payload = await res.json();
  return payload.data.map((row: { embedding: number[] }) => row.embedding);
}

async function backfill(batchSize: number, maxSeconds: number, sourceType: string | null) {
  const start = Date.now();
  let processed = 0;

  while (Date.now() - start < maxSeconds * 1000) {
    let query = supabase
      .from("catalog_embeddings")
      .select("id, source_type, source_id, content")
      .is("embedding", null)
      .order("id", { ascending: true })
      .limit(batchSize);

    if (sourceType) query = query.eq("source_type", sourceType);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) break;

    const vectors = await embedBatch(rows.map((row) => stripHtml(row.content)));
    for (let index = 0; index < rows.length; index += 1) {
      const { error: updateError } = await supabase
        .from("catalog_embeddings")
        .update({
          embedding: `[${vectors[index].join(",")}]`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rows[index].id);
      if (updateError) throw new Error(updateError.message);
      processed += 1;
    }
  }

  let remainingQuery = supabase
    .from("catalog_embeddings")
    .select("*", { count: "exact", head: true })
    .is("embedding", null);
  if (sourceType) remainingQuery = remainingQuery.eq("source_type", sourceType);
  const { count } = await remainingQuery;

  return { ok: true, processed, remaining: count ?? 0 };
}

async function exportCatalog(limit: number) {
  const { data, error } = await supabase
    .from("catalog_embeddings")
    .select("id, source_type, source_id, content, metadata, updated_at")
    .order("source_type", { ascending: true })
    .order("source_id", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  const rows = data || [];

  const markdownLines = [
    "# Heavy Iron Supply Co. Machine-Readable Catalog",
    "",
    "| Type | Source ID | Entity | Size | Tread | Handle | Summary |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => {
      const meta = row.metadata || {};
      const entity = [meta.make, meta.model, meta.title, meta.sku].filter(Boolean).join(" ");
      return `| ${[
        md(row.source_type),
        md(row.source_id),
        md(entity),
        md(meta.track_size || meta.size),
        md(meta.tread_pattern || meta.tread),
        md(meta.handle),
        md(row.content),
      ].join(" | ")} |`;
    }),
    "",
  ];

  const graph = rows.map((row) => {
    const meta = row.metadata || {};
    return {
      "@type": row.source_type === "model" ? "ProductModel" : "Product",
      "@id": `urn:heavy-iron:${row.source_type}:${row.source_id}`,
      name: stripHtml(meta.title || [meta.make, meta.model, meta.track_size, meta.tread_pattern].filter(Boolean).join(" ") || row.content).slice(0, 180),
      sku: meta.sku || undefined,
      url: meta.handle ? `https://heavyironsupply.com/products/${meta.handle}` : undefined,
      category: meta.part_type || row.source_type,
      additionalProperty: [
        meta.track_size ? { "@type": "PropertyValue", name: "Track Size", value: meta.track_size } : null,
        meta.tread_pattern ? { "@type": "PropertyValue", name: "Tread Pattern", value: meta.tread_pattern } : null,
        meta.make ? { "@type": "PropertyValue", name: "Machine Make", value: meta.make } : null,
        meta.model ? { "@type": "PropertyValue", name: "Machine Model", value: meta.model } : null,
      ].filter(Boolean),
    };
  });

  return {
    ok: true,
    count: rows.length,
    llm_txt: markdownLines.join("\n"),
    jsonld: {
      "@context": "https://schema.org",
      "@graph": graph,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body.action || url.searchParams.get("action") || "backfill");

    if (action === "export") {
      const limit = Math.min(Math.max(Number(body.limit || url.searchParams.get("limit") || 500), 1), 5000);
      return json(await exportCatalog(limit));
    }

    const batchSize = Math.min(Math.max(Number(body.batch_size || body.limit || 100), 1), 200);
    const maxSeconds = Math.min(Math.max(Number(body.max_seconds || 120), 5), 240);
    const sourceType = body.source_type ? String(body.source_type) : null;
    return json(await backfill(batchSize, maxSeconds, sourceType));
  } catch (error) {
    return json({ ok: false, error: String(error) }, 500);
  }
});
