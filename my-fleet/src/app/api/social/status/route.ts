import { NextResponse } from "next/server";
import { getSocialConnection } from "@/lib/content-studio/queries";

export async function GET() {
  try {
    const connection = await getSocialConnection();
    const envConfigured = Boolean(
      process.env.META_ACCESS_TOKEN && process.env.META_PAGE_ID,
    );
    return NextResponse.json({
      connection,
      env_fallback_configured: envConfigured,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
