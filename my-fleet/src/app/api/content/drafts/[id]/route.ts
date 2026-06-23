import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("content_draft").select("*").eq("draft_id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await request.json();
  const supabase = createAdminClient();

  const allowed = ["headline", "body", "caption", "shopify_url", "image_url", "media_id", "status"];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  if (patch.status === "approved" || patch.status === "published") {
    return NextResponse.json(
      { error: "Use /approve or /publish endpoints for status transitions" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("content_draft")
    .update(patch)
    .eq("draft_id", id)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = createAdminClient();
  const { error } = await supabase.from("content_draft").delete().eq("draft_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
