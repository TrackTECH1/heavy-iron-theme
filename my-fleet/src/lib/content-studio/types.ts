export type EntityType = "machine" | "track_size" | "product";

export type DraftStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "published"
  | "rejected";

export type PublishPlatform = "facebook" | "instagram" | "both";

export interface ContentDraft {
  draft_id: string;
  campaign_id: string | null;
  entity_type: EntityType;
  entity_id: string;
  entity_label: string | null;
  headline: string | null;
  body: string;
  caption: string;
  shopify_url: string | null;
  image_url: string | null;
  media_id: string | null;
  status: DraftStatus;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  approved_by: string | null;
  published_at: string | null;
}

export interface ContentAsset {
  asset_id: string;
  draft_id: string;
  media_id: string | null;
  url: string;
  role: "primary" | "gallery" | "alt";
  sort_order: number;
}

export interface SocialConnection {
  account_id: string;
  platform: string;
  page_id: string | null;
  page_name: string | null;
  instagram_business_account_id: string | null;
  token_vault_ref: string;
  token_expires_at: string | null;
  status: string;
  connected_at: string | null;
  has_token: boolean;
}

export interface ImageOption {
  url: string;
  media_id: string | null;
  label: string;
  role?: string;
}

export interface GeneratePostInput {
  entityType: EntityType;
  entityId: string;
}

export interface GeneratePostResult {
  entity_type: EntityType;
  entity_id: string;
  entity_label: string;
  headline: string;
  body: string;
  caption: string;
  shopify_url: string;
  image_options: ImageOption[];
  suggested_image_url: string | null;
}
