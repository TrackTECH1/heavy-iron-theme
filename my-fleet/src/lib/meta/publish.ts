import {
  metaGraphBase,
  resolveIgBusinessId,
  resolveMetaAccessToken,
  resolveMetaPageId,
} from "@/lib/meta/config";

export interface PublishInput {
  caption: string;
  imageUrl: string;
  pageToken?: string;
  pageId?: string;
  igBusinessId?: string;
}

export async function publishFacebookPhoto(input: PublishInput) {
  const token = input.pageToken ?? resolveMetaAccessToken();
  const pageId = input.pageId ?? resolveMetaPageId();

  const body = new URLSearchParams({
    url: input.imageUrl,
    caption: input.caption,
    access_token: token,
  });

  const res = await fetch(`${metaGraphBase()}/${pageId}/photos`, {
    method: "POST",
    body,
  });
  const json = (await res.json()) as { id?: string; post_id?: string; error?: { message: string } };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? "Facebook publish failed");
  }
  return { externalId: json.post_id ?? json.id ?? null, response: json };
}

export async function publishInstagramPhoto(input: PublishInput) {
  const token = input.pageToken ?? resolveMetaAccessToken();
  const igId = input.igBusinessId ?? resolveIgBusinessId();

  const createParams = new URLSearchParams({
    image_url: input.imageUrl,
    caption: input.caption,
    access_token: token,
  });

  const createRes = await fetch(`${metaGraphBase()}/${igId}/media`, {
    method: "POST",
    body: createParams,
  });
  const createJson = (await createRes.json()) as {
    id?: string;
    error?: { message: string };
  };
  if (!createRes.ok || !createJson.id) {
    throw new Error(createJson.error?.message ?? "Instagram media container failed");
  }

  const publishParams = new URLSearchParams({
    creation_id: createJson.id,
    access_token: token,
  });
  const publishRes = await fetch(`${metaGraphBase()}/${igId}/media_publish`, {
    method: "POST",
    body: publishParams,
  });
  const publishJson = (await publishRes.json()) as {
    id?: string;
    error?: { message: string };
  };
  if (!publishRes.ok || !publishJson.id) {
    throw new Error(publishJson.error?.message ?? "Instagram publish failed");
  }

  return { externalId: publishJson.id, containerId: createJson.id, response: publishJson };
}
