import { NextResponse } from "next/server";
import { listDrafts } from "@/lib/content-studio/queries";

function csvEscape(value: string | null | undefined) {
  const s = value ?? "";
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  try {
    const drafts = await listDrafts(undefined, 5000);
    const header = [
      "draft_id",
      "entity_type",
      "entity_id",
      "entity_label",
      "headline",
      "caption",
      "shopify_url",
      "image_url",
      "status",
      "approved_at",
      "published_at",
      "created_at",
    ];
    const lines = [header.join(",")];
    for (const d of drafts) {
      lines.push(
        [
          d.draft_id,
          d.entity_type,
          d.entity_id,
          d.entity_label,
          d.headline,
          d.caption,
          d.shopify_url,
          d.image_url,
          d.status,
          d.approved_at,
          d.published_at,
          d.created_at,
        ]
          .map((v) => csvEscape(v))
          .join(","),
      );
    }
    const csv = lines.join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="content-drafts-export.csv"',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
