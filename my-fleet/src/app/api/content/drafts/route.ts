import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { generatePostFromEntity } from "@/lib/content-studio/generator";
import { newId } from "@/lib/content-studio/ids";
import type { EntityType } from "@/lib/content-studio/types";

export async function GET(request: NextRequest) {
  const entityType = request.nextUrl.searchParams.get("entityType") as EntityType | null;
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (!entityType || !entityId) {
    return NextResponse.json({ error: "entityType and entityId required" }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const generated = await generatePostFromEntity(supabase, entityType, entityId);
    return NextResponse.json(generated);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const supabase = createAdminClient();
    const draftId = newId("draft");
    const now = new Date().toISOString();

    const row = {
      draft_id: draftId,
      campaign_id: body.campaign_id ?? null,
      entity_type: body.entity_type as EntityType,
      entity_id: body.entity_id,
      entity_label: body.entity_label ?? null,
      headline: body.headline ?? null,
      body: body.body ?? "",
      caption: body.caption ?? "",
      shopify_url: body.shopify_url ?? null,
      image_url: body.image_url ?? null,
      media_id: body.media_id ?? null,
      status: "draft" as const,
      created_at: now,
      updated_at: now,
    };

    const { error } = await supabase.from("content_draft").insert(row);
    if (error) throw new Error(error.message);

    if (body.image_url) {
      await supabase.from("content_asset").insert({
        asset_id: newId("asset"),
        draft_id: draftId,
        media_id: body.media_id ?? null,
        url: body.image_url,
        role: "primary",
        sort_order: 0,
      });
    }

    return NextResponse.json({ draft_id: draftId, status: "draft" });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
