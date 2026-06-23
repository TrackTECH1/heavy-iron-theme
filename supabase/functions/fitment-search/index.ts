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

function clampLimit(value: unknown) {
  const parsed = Number(value || 24);
  if (!Number.isFinite(parsed)) return 24;
  return Math.min(Math.max(Math.trunc(parsed), 1), 50);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const q = String(url.searchParams.get("q") || body.q || body.query || "").trim();
    const limit = clampLimit(url.searchParams.get("limit") || body.limit);

    if (q.length < 2) {
      return json({
        query: q,
        machines: [],
        groups: [],
        callout: "Enter at least two characters to search verified fitments.",
      });
    }

    const { data, error } = await supabase.rpc("get_fitment_search_payload", {
      search_q: q,
      result_limit: limit,
    });

    if (error) throw error;
    return json(data || { query: q, machines: [], groups: [], callout: "No verified fitments found yet." });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
});
