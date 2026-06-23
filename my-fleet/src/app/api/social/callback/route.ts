import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  exchangeCodeForToken,
  exchangeLongLivedUserToken,
  fetchUserPages,
} from "@/lib/meta/oauth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  const redirectBase = "/content-studio/connections";

  if (error) {
    return NextResponse.redirect(`${redirectBase}?error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${redirectBase}?error=missing_code`);
  }

  const cookieStore = await cookies();
  const expected = cookieStore.get("meta_oauth_state")?.value;
  cookieStore.delete("meta_oauth_state");

  if (!expected || expected !== state) {
    return NextResponse.redirect(`${redirectBase}?error=invalid_state`);
  }

  try {
    const shortToken = await exchangeCodeForToken(code);
    const long = await exchangeLongLivedUserToken(shortToken);
    const pages = await fetchUserPages(long.access_token!);

    const preferredPageId = process.env.META_PAGE_ID;
    const page =
      pages.find((p) => p.id === preferredPageId) ??
      pages.find((p) => p.instagram_business_account?.id) ??
      pages[0];

    if (!page) {
      return NextResponse.redirect(`${redirectBase}?error=no_pages`);
    }

    const igId = page.instagram_business_account?.id ?? process.env.META_IG_BUSINESS_ACCOUNT_ID ?? null;
    const expiresAt = long.expires_in
      ? new Date(Date.now() + long.expires_in * 1000).toISOString()
      : null;

    const supabase = createAdminClient();
    const accountId = "meta_primary";
    const now = new Date().toISOString();

    await supabase.from("social_account").upsert({
      account_id: accountId,
      platform: "meta",
      page_id: page.id,
      page_name: page.name,
      instagram_business_account_id: igId,
      access_token: page.access_token,
      token_vault_ref: "db:social_account.access_token",
      token_expires_at: expiresAt,
      status: "connected",
      connected_at: now,
      updated_at: now,
    });

    return NextResponse.redirect(`${redirectBase}?connected=1`);
  } catch (e) {
    return NextResponse.redirect(
      `${redirectBase}?error=${encodeURIComponent((e as Error).message)}`,
    );
  }
}
