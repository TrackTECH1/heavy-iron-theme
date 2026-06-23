import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { newId } from "@/lib/content-studio/ids";
import { publishFacebookPhoto, publishInstagramPhoto } from "@/lib/meta/publish";
import type { PublishPlatform } from "@/lib/content-studio/types";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: draftId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const platform = (body.platform ?? "both") as PublishPlatform;

  const supabase = createAdminClient();

  const { data: draft, error: draftErr } = await supabase
    .from("content_draft")
    .select("*")
    .eq("draft_id", draftId)
    .maybeSingle();

  if (draftErr) return NextResponse.json({ error: draftErr.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  if (draft.status !== "approved") {
    return NextResponse.json(
      { error: "Only approved drafts can be published. Approve first." },
      { status: 403 },
    );
  }
  if (!draft.image_url) {
    return NextResponse.json({ error: "Draft has no image_url" }, { status: 400 });
  }
  if (!draft.caption?.trim()) {
    return NextResponse.json({ error: "Draft has no caption" }, { status: 400 });
  }

  const { data: account } = await supabase.from("social_account").select("*").eq("platform", "meta").maybeSingle();

  const jobId = newId("job");
  const now = new Date().toISOString();
  await supabase.from("social_publish_job").insert({
    job_id: jobId,
    draft_id: draftId,
    platform,
    status: "running",
    started_at: now,
    created_by: body.created_by ?? "content-studio",
  });

  const publishInput = {
    caption: draft.caption as string,
    imageUrl: draft.image_url as string,
    pageToken: account?.access_token ?? undefined,
    pageId: account?.page_id ?? undefined,
    igBusinessId: account?.instagram_business_account_id ?? undefined,
  };

  const results: { platform: string; ok: boolean; externalId?: string | null; error?: string }[] = [];

  try {
    if (platform === "facebook" || platform === "both") {
      try {
        const fb = await publishFacebookPhoto(publishInput);
        results.push({ platform: "facebook", ok: true, externalId: fb.externalId });
        await supabase.from("social_publish_log").insert({
          log_id: newId("log"),
          job_id: jobId,
          draft_id: draftId,
          platform: "facebook",
          external_post_id: fb.externalId,
          status: "succeeded",
          request_payload: { caption: draft.caption, image_url: draft.image_url },
          response_payload: fb.response,
        });
      } catch (e) {
        const msg = (e as Error).message;
        results.push({ platform: "facebook", ok: false, error: msg });
        await supabase.from("social_publish_log").insert({
          log_id: newId("log"),
          job_id: jobId,
          draft_id: draftId,
          platform: "facebook",
          status: "failed",
          error_message: msg,
          request_payload: { caption: draft.caption, image_url: draft.image_url },
        });
      }
    }

    if (platform === "instagram" || platform === "both") {
      try {
        const ig = await publishInstagramPhoto(publishInput);
        results.push({ platform: "instagram", ok: true, externalId: ig.externalId });
        await supabase.from("social_publish_log").insert({
          log_id: newId("log"),
          job_id: jobId,
          draft_id: draftId,
          platform: "instagram",
          external_post_id: ig.externalId,
          status: "succeeded",
          request_payload: { caption: draft.caption, image_url: draft.image_url },
          response_payload: ig.response,
        });
      } catch (e) {
        const msg = (e as Error).message;
        results.push({ platform: "instagram", ok: false, error: msg });
        await supabase.from("social_publish_log").insert({
          log_id: newId("log"),
          job_id: jobId,
          draft_id: draftId,
          platform: "instagram",
          status: "failed",
          error_message: msg,
          request_payload: { caption: draft.caption, image_url: draft.image_url },
        });
      }
    }

    const allOk = results.every((r) => r.ok);
    const anyOk = results.some((r) => r.ok);
    const jobStatus = allOk ? "succeeded" : anyOk ? "partial" : "failed";

    await supabase
      .from("social_publish_job")
      .update({ status: jobStatus, completed_at: new Date().toISOString() })
      .eq("job_id", jobId);

    if (allOk) {
      await supabase
        .from("content_draft")
        .update({ status: "published", published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("draft_id", draftId);
    }

    return NextResponse.json({ job_id: jobId, status: jobStatus, results });
  } catch (e) {
    await supabase
      .from("social_publish_job")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("job_id", jobId);
    return NextResponse.json({ error: (e as Error).message, job_id: jobId }, { status: 500 });
  }
}
