#!/usr/bin/env bash
# Consolidate fitment to custom.fitments (Supabase sync path only).
# Prerequisites: shopify store auth, npx supabase login (for auto service-role key), deployed edge functions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORE="${SHOPIFY_STORE:-tracktech-530.myshopify.com}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-tcykyktvdlsbscrsbjyt}"
export SUPABASE_URL="${SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"
FN_BASE="${SUPABASE_URL}/functions/v1"

load_service_role_key() {
  [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] && return 0
  local keys_json
  if ! keys_json=$(npx supabase projects api-keys --project-ref "$PROJECT_REF" 2>/dev/null); then
    return 1
  fi
  SUPABASE_SERVICE_ROLE_KEY=$(echo "$keys_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for k in data.get('keys', []):
    if k.get('name') == 'service_role' or k.get('id') == 'service_role':
        print(k['api_key'])
        break
" 2>/dev/null || true)
  [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] || return 1
  export SUPABASE_SERVICE_ROLE_KEY
  echo "Loaded SUPABASE_SERVICE_ROLE_KEY via npx supabase projects api-keys"
}

echo "== 1. Backfill Shopify product GIDs in Supabase =="
if load_service_role_key; then
  python3 "$ROOT/scripts/backfill-shopify-product-ids.py" --apply
else
  echo "Set SUPABASE_SERVICE_ROLE_KEY to run backfill (or run: npx supabase login)."
fi

echo "== 2. Live sync all eligible products (custom.fitments) =="
offset=0
limit=50
while true; do
  payload=$(printf '{"dry_run":false,"limit":%s,"offset":%s}' "$limit" "$offset")
  resp=$(curl -sS -X POST "$FN_BASE/sync-product-fitments" \
    -H "Content-Type: application/json" \
    -d "$payload")
  echo "$resp" | python3 -m json.tool 2>/dev/null || echo "$resp"
  remaining=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('remaining',0))" 2>/dev/null || echo 0)
  processed=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processed',0))" 2>/dev/null || echo 0)
  [[ "$processed" -eq 0 ]] && break
  offset=$((offset + limit))
  [[ "$remaining" -eq 0 ]] && break
done

echo "== 3. Clear legacy fits_equipment_models where custom.fitments is set =="
python3 "$ROOT/scripts/clear-fits-equipment-models.py" --apply

echo "Done. Run dry-run sync to verify:"
echo "  curl -X POST $FN_BASE/sync-product-fitments -H 'Content-Type: application/json' -d '{\"dry_run\":true,\"limit\":5}'"
