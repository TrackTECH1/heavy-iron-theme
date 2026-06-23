import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const supabase = createAdminClient();

  const { data: draft, error: fetchErr } = await supabase
    .from("content_draft")
    .select("*")
    .eq("draft_id", id)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (draft.status === "published") {
    return NextResponse.json({ error: "Draft already published" }, { status: 400 });
  }
  if (draft.status === "approved") {
    return NextResponse.json({ draft });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("content_draft")
    .update({
      status: "approved",
      approved_at: now,
      approved_by: body.approved_by ?? "content-studio",
      updated_at: now,
    })
    .eq("draft_id", id)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ draft: data });
}
