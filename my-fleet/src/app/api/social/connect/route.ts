import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildMetaOAuthUrl } from "@/lib/meta/oauth";
import { randomUUID } from "crypto";

export async function GET() {
  try {
    const state = randomUUID();
    const cookieStore = await cookies();
    cookieStore.set("meta_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    const url = buildMetaOAuthUrl(state);
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
