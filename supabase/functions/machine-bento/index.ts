import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function normalizeSlug(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/[^/]+\/pages\/model\//i, "")
    .replace(/^\/?pages\/model\//i, "")
    .split("?")[0]
    .split("#")[0]
    .toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const slug = normalizeSlug(
      url.searchParams.get("slug") ||
        url.searchParams.get("model_key") ||
        url.searchParams.get("model") ||
        body.slug ||
        body.model_key ||
        body.model,
    );

    if (slug.length < 2) {
      return json({
        error: "missing_slug",
        message: "Provide a machine model slug, for example ?slug=bobcat-t66.",
      }, 400);
    }

    const { data, error } = await supabase.rpc("get_machine_bento", { slug });
    if (error) throw error;

    const payload = data || { machine: {}, tracks: [], undercarriage: [], attachments: [] };
    return json({
      source: "supabase",
      slug,
      ...payload,
    });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
});
