# My Fleet Content Studio — Social Publishing

Generate Facebook Page and Instagram Business posts from **approved Supabase / My Fleet data**. Nothing publishes without explicit approval.

## Architecture

```
Supabase dev views          Content Studio              Meta Graph API
─────────────────          ──────────────              ──────────────
fleet_model_hero      →    Post Generator         →    (draft only)
fleet_track_size_media     Draft Library
fleet_product_media        Approval Queue       →    Pages API (Facebook)
                           Publish (approved)   →    Content Publishing (Instagram)
```

## Tables

| Table | Purpose |
|-------|---------|
| `content_campaign` | Optional grouping for drafts |
| `content_draft` | Post copy, image URL, Shopify link, status |
| `content_asset` | Additional images per draft |
| `social_account` | Page + IG IDs; token stored server-side only |
| `social_publish_job` | Publish attempt per draft |
| `social_publish_log` | Per-platform result + external post ID |

Migration: `supabase/migrations/20260623180000_content_social_studio.sql`

Apply on dev:

```bash
# From repo root (uses Supabase branch Postgres URL)
python3 - <<'PY'
import json, subprocess, psycopg
from pathlib import Path
out = subprocess.check_output([
  "npx", "supabase", "branches", "get", "zhdqdxtwipcowbtdyviq",
  "--project-ref", "tcykyktvdlsbscrsbjyt", "-o", "json"
], text=True)
sql = Path("supabase/migrations/20260623180000_content_social_studio.sql").read_text()
with psycopg.connect(json.loads(out)["POSTGRES_URL"]) as conn:
    conn.execute(sql)
    conn.commit()
print("OK")
PY
```

## UI routes

| Route | Purpose |
|-------|---------|
| `/content-studio` | Overview |
| `/content-studio/generate` | Generate from machine / track size / SKU |
| `/content-studio/drafts` | Draft library |
| `/content-studio/approval` | Approve before publish |
| `/content-studio/connections` | Meta OAuth + publish log |
| `/content-studio/export` | CSV export |

## Workflow (no auto-post)

1. **Generate** — pulls entity + media from clean fleet views
2. **Select image** — from `fleet_*_media` library
3. **Save draft** — status `draft`
4. **Approve** — status `approved` (required)
5. **Publish** — Facebook `/photos`, Instagram container + `media_publish`
6. **Log** — `social_publish_job` + `social_publish_log`

Unapproved drafts return **403** from `/api/content/drafts/[id]/publish`.

## Meta setup

1. Create a [Meta Developer app](https://developers.facebook.com/)
2. Add **Facebook Login** and **Instagram Graph API** products
3. Connect a **Facebook Page** and link an **Instagram Business/Creator** account to that Page
4. Request permissions: `pages_manage_posts`, `instagram_content_publish`, `pages_show_list`, `instagram_basic`
5. Set OAuth redirect: `{APP_URL}/api/social/callback`

### Environment variables (server-only except public Supabase)

Copy `my-fleet/.env.local.example` → `.env.local`:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Draft CRUD + publish logs (never in browser) |
| `META_APP_ID` / `META_APP_SECRET` | OAuth |
| `META_REDIRECT_URI` | OAuth callback URL |
| `META_PAGE_ID` | Default Page (optional if OAuth selects) |
| `META_IG_BUSINESS_ACCOUNT_ID` | Instagram Business account |
| `META_ACCESS_TOKEN` | Fallback Page token if not using OAuth DB storage |
| `SHOPIFY_PUBLIC_URL` | Link destination in captions |

Tokens are **never** returned from `/api/social/status` — only `fleet_social_connection.has_token`.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/content/drafts?entityType=&entityId=` | Generate post payload |
| POST | `/api/content/drafts` | Save draft |
| POST | `/api/content/drafts/[id]/approve` | Approve draft |
| POST | `/api/content/drafts/[id]/publish` | Publish approved draft (`platform`: facebook \| instagram \| both) |
| GET | `/api/content/export` | CSV download |
| GET | `/api/social/connect` | Start Meta OAuth |
| GET | `/api/social/callback` | OAuth callback |
| GET | `/api/social/status` | Connection metadata (no token) |

## Publishing notes

- **V1**: Single-image posts only (Facebook Page photo, Instagram image feed)
- **V2**: Reels, carousels, scheduled posts
- Instagram requires a **publicly accessible** `image_url` (Supabase storage CDN URLs work)
- Image URLs must not be `product_url` fields — only approved media library URLs

## Dev commands

```bash
cd my-fleet
npm run dev
# Open http://localhost:3000/content-studio
```

## Related docs

- `supabase/quality-audit/DATA_CONTRACT.md` — fleet view contracts
- `supabase/quality-audit/AUTHORITY_RULES.md` — human approval before publish
