import { metaGraphBase, requireMetaAppConfig } from "@/lib/meta/config";

const META_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

export function buildMetaOAuthUrl(state: string) {
  const { appId, redirectUri } = requireMetaAppConfig();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: META_SCOPES,
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string) {
  const { appId, appSecret, redirectUri } = requireMetaAppConfig();
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${metaGraphBase()}/oauth/access_token?${params}`);
  const json = (await res.json()) as { access_token?: string; error?: { message: string } };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error?.message ?? "OAuth token exchange failed");
  }
  return json.access_token;
}

export async function exchangeLongLivedUserToken(shortToken: string) {
  const { appId, appSecret } = requireMetaAppConfig();
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${metaGraphBase()}/oauth/access_token?${params}`);
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message: string };
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error?.message ?? "Long-lived token exchange failed");
  }
  return json;
}

export async function fetchUserPages(userToken: string) {
  const params = new URLSearchParams({
    access_token: userToken,
    fields: "id,name,access_token,instagram_business_account{id,username}",
  });
  const res = await fetch(`${metaGraphBase()}/me/accounts?${params}`);
  const json = (await res.json()) as {
    data?: Array<{
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: { id: string; username?: string };
    }>;
    error?: { message: string };
  };
  if (!res.ok) throw new Error(json.error?.message ?? "Failed to list Facebook Pages");
  return json.data ?? [];
}
