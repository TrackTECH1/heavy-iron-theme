const GRAPH_VERSION = "v21.0";

export function metaGraphBase() {
  return `https://graph.facebook.com/${GRAPH_VERSION}`;
}

export function requireMetaAppConfig() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) {
    throw new Error("Missing META_APP_ID, META_APP_SECRET, or META_REDIRECT_URI");
  }
  return { appId, appSecret, redirectUri };
}

export function shopifyStoreBase() {
  const publicUrl = process.env.SHOPIFY_PUBLIC_URL;
  if (publicUrl) return publicUrl.replace(/\/$/, "");
  const domain = process.env.SHOPIFY_STORE_DOMAIN ?? "tracktech-530.myshopify.com";
  return `https://${domain}`;
}

/** Resolve page access token: DB row first, then env fallback. Server-only. */
export function resolveMetaAccessToken(account?: { access_token?: string | null; token_vault_ref?: string | null }) {
  if (account?.access_token) return account.access_token;
  const envToken = process.env.META_ACCESS_TOKEN;
  if (envToken) return envToken;
  throw new Error("No Meta access token configured (connect OAuth or set META_ACCESS_TOKEN)");
}

export function resolveMetaPageId(account?: { page_id?: string | null }) {
  const pageId = account?.page_id ?? process.env.META_PAGE_ID;
  if (!pageId) throw new Error("Missing Meta Page ID (connect or set META_PAGE_ID)");
  return pageId;
}

export function resolveIgBusinessId(account?: { instagram_business_account_id?: string | null }) {
  const igId = account?.instagram_business_account_id ?? process.env.META_IG_BUSINESS_ACCOUNT_ID;
  if (!igId) throw new Error("Missing Instagram Business account ID");
  return igId;
}
