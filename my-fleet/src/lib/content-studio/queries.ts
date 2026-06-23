import { createAdminClient } from "@/lib/supabase-admin";
import type { ContentDraft, DraftStatus, SocialConnection } from "@/lib/content-studio/types";

export async function listDrafts(status?: DraftStatus, limit = 100): Promise<ContentDraft[]> {
  const supabase = createAdminClient();
  let q = supabase
    .from("content_draft")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ContentDraft[];
}

export async function getDraft(draftId: string): Promise<ContentDraft | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("content_draft")
    .select("*")
    .eq("draft_id", draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ContentDraft | null;
}

export async function getSocialConnection(): Promise<SocialConnection | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("fleet_social_connection")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as SocialConnection | null;
}

export async function getPublishLogs(limit = 50) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("social_publish_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
