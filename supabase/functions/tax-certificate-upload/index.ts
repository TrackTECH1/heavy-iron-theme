import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "tax-exemption-certificates";
const MAX_BYTES = 10 * 1024 * 1024;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

function cleanFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96) || "certificate";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return json({ ok: false, error: "multipart_form_data_required" }, 400);
    }

    const form = await req.formData();
    const file = form.get("file");
    const email = String(form.get("email") || "").trim().slice(0, 160);
    const company = String(form.get("company") || "").trim().slice(0, 160);
    const cartToken = String(form.get("cart_token") || "").trim().slice(0, 160);

    if (!(file instanceof File)) return json({ ok: false, error: "missing_file" }, 400);
    if (file.size > MAX_BYTES) return json({ ok: false, error: "file_too_large" }, 413);
    if (!ALLOWED_TYPES.has(file.type)) return json({ ok: false, error: "unsupported_file_type" }, 415);

    const now = new Date();
    const path = [
      "pending",
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      `${crypto.randomUUID()}-${cleanFilename(file.name)}`,
    ].join("/");

    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
      metadata: {
        original_filename: file.name,
        buyer_email: email,
        company,
        status: "pending_admin_review",
      },
    });

    if (error) throw new Error(error.message);

    const expiresIn = 60 * 60;
    const { data: signed, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
    if (signedError) throw new Error(signedError.message);

    const { data: flag, error: flagError } = await supabase
      .from("order_flags")
      .insert({
        flag_type: "tax_exemption_certificate",
        status: "pending_admin_review",
        shopify_cart_token: cartToken || null,
        buyer_email: email || null,
        company: company || null,
        storage_bucket: BUCKET,
        storage_path: path,
        signed_url: signed?.signedUrl || null,
        signed_url_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        metadata: {
          original_filename: file.name,
          content_type: file.type,
          size: file.size,
        },
      })
      .select("id")
      .single();

    if (flagError) throw new Error(flagError.message);

    return json({
      ok: true,
      status: "pending_admin_review",
      bucket: BUCKET,
      path,
      filename: file.name,
      flag_id: flag?.id || null,
      reference: `${BUCKET}/${path}`,
    });
  } catch (error) {
    return json({ ok: false, error: String(error) }, 500);
  }
});
