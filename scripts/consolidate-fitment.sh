#!/usr/bin/env bash
# Consolidate fitment to custom.fitments (Supabase sync path only).
# Prerequisites: shopify store auth, SUPABASE_SERVICE_ROLE_KEY, deployed edge functions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORE="${SHOPIFY_STORE:-tracktech-530.myshopify.com}"
FN_BASE="${SUPABASE_URL:-https://tcykyktvdlsbscrsbjyt.supabase.co}/functions/v1"

echo "== 1. Backfill Shopify product GIDs in Supabase =="
if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "Set SUPABASE_SERVICE_ROLE_KEY to run backfill."
else
  python3 "$ROOT/scripts/backfill-shopify-product-ids.py" --apply
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
