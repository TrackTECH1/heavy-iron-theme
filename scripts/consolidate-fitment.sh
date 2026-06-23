#!/usr/bin/env bash
# Consolidate fitment to custom.fitments (Supabase sync path only).
#
# Prefer:  ./scripts/fitment sync
# Once:    ./scripts/fitment setup   → writes .env.fitment.local (Shopify token + keys)
# Or:      ./scripts/fitment bootstrap  → service role only (Shopify via CLI)
#
# Prerequisites:
#   npx supabase login (if service role not in .env.fitment.local)
#   ./scripts/fitment setup (optional — faster backfill with SHOPIFY_ADMIN_TOKEN)
#   shopify store auth --store tracktech-530.myshopify.com (if no admin token)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/fitment-env.sh
source "$ROOT/scripts/lib/fitment-env.sh"

load_fitment_env
FN_BASE="${SUPABASE_URL}/functions/v1"

echo "== 1. Backfill Shopify product GIDs in Supabase =="
if ! load_service_role_key; then
  echo "ERROR: Cannot run backfill without Supabase service role key." >&2
  echo "  Fix: npx supabase login" >&2
  echo "  Then: ./scripts/fitment bootstrap  OR  ./scripts/fitment setup" >&2
  exit 1
fi
if [[ -f "$FITMENT_ENV_FILE" ]] && grep -q '^SUPABASE_SERVICE_ROLE_KEY=' "$FITMENT_ENV_FILE" 2>/dev/null; then
  echo "Using SUPABASE_SERVICE_ROLE_KEY from .env.fitment.local"
else
  echo "Loaded SUPABASE_SERVICE_ROLE_KEY via Supabase CLI"
fi

if [[ -z "${SHOPIFY_ADMIN_TOKEN:-}" ]]; then
  echo "WARN: SHOPIFY_ADMIN_TOKEN not set — using Shopify CLI (slower). Run: ./scripts/fitment setup" >&2
fi
if ! python3 "$ROOT/scripts/backfill-shopify-product-ids.py" --apply; then
  echo "ERROR: Backfill failed — sync skipped." >&2
  exit 1
fi

echo "== 2. Live sync all eligible products (custom.fitments) =="
offset=0
limit=50
total_synced=0
while true; do
  payload=$(printf '{"dry_run":false,"limit":%s,"offset":%s}' "$limit" "$offset")
  resp=$(curl -sS -X POST "$FN_BASE/sync-product-fitments" \
    -H "Content-Type: application/json" \
    -d "$payload")
  echo "$resp" | python3 -m json.tool 2>/dev/null || echo "$resp"
  remaining=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('remaining',0))" 2>/dev/null || echo 0)
  processed=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processed',0))" 2>/dev/null || echo 0)
  total_synced=$((total_synced + processed))
  [[ "$processed" -eq 0 ]] && break
  offset=$((offset + limit))
  [[ "$remaining" -eq 0 ]] && break
done
echo "Synced $total_synced product batches total."

echo "== 3. Clear legacy fits_equipment_models where custom.fitments is set =="
python3 "$ROOT/scripts/clear-fits-equipment-models.py" --apply

echo "== 4. Sync Model metaobject product lists (track_products / uc_products) =="
python3 "$ROOT/scripts/sync-model-product-refs.py" --apply

echo "Done. Verify:"
echo "  curl -sS -X POST $FN_BASE/sync-product-fitments -H 'Content-Type: application/json' -d '{\"dry_run\":true,\"limit\":5}' | python3 -m json.tool"
