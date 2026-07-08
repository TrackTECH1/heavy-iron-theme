#!/usr/bin/env bash
# Consolidate fitment to custom.fitments (Supabase sync path only).
#
# Pipeline: (1) backfill Shopify product GIDs in Supabase, (2) live-sync custom.fitments,
# (3) clear the legacy custom.fits_equipment_models metafield.
#
# Step 3 is DESTRUCTIVE and irreversible, so the whole pipeline fails closed:
#   - SUPABASE_SERVICE_ROLE_KEY is REQUIRED (step 1 cannot be silently skipped).
#   - SYNC_API_KEY is REQUIRED (live sync fails closed server-side without it).
#   - A non-zero sync error/HTTP failure aborts before the clear runs.
#   - The clear requires an explicit confirmation (set FORCE=1 to skip the prompt in CI).
#
# Prerequisites: shopify store auth, SUPABASE_SERVICE_ROLE_KEY, SYNC_API_KEY, deployed edge functions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORE="${SHOPIFY_STORE:-tracktech-530.myshopify.com}"
FN_BASE="${SUPABASE_URL:-https://tcykyktvdlsbscrsbjyt.supabase.co}/functions/v1"

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "ERROR: SUPABASE_SERVICE_ROLE_KEY is required (step 3 deletes legacy data and must not run"
  echo "       without a completed GID backfill). Aborting." >&2
  exit 1
fi
if [[ -z "${SYNC_API_KEY:-}" ]]; then
  echo "ERROR: SYNC_API_KEY is required — live sync fails closed without it. Aborting." >&2
  exit 1
fi

echo "== 1. Backfill Shopify product GIDs in Supabase =="
python3 "$ROOT/scripts/backfill-shopify-product-ids.py" --apply

echo "== 2. Live sync all eligible products (custom.fitments) =="
offset=0
limit=50
sync_ok=1
while true; do
  payload=$(printf '{"dry_run":false,"limit":%s,"offset":%s}' "$limit" "$offset")
  # --fail-with-body: non-2xx becomes a non-zero exit while still printing the body.
  if ! resp=$(curl -sS --fail-with-body -X POST "$FN_BASE/sync-product-fitments" \
        -H "Content-Type: application/json" \
        -H "x-sync-key: ${SYNC_API_KEY}" \
        -d "$payload"); then
    echo "ERROR: sync request failed (HTTP error). Response:" >&2
    echo "$resp" >&2
    sync_ok=0
    break
  fi
  echo "$resp" | python3 -m json.tool 2>/dev/null || echo "$resp"

  # An `error` field in the JSON body is a soft failure — abort before the destructive clear.
  if echo "$resp" | python3 -c "import sys,json; sys.exit(0 if json.load(sys.stdin).get('error') else 1)" 2>/dev/null; then
    echo "ERROR: sync returned an error payload. Aborting before clear." >&2
    sync_ok=0
    break
  fi

  remaining=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('remaining',0))" 2>/dev/null || echo 0)
  processed=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processed',0))" 2>/dev/null || echo 0)
  [[ "$processed" -eq 0 ]] && break
  offset=$((offset + limit))
  [[ "$remaining" -eq 0 ]] && break
done

if [[ "$sync_ok" -ne 1 ]]; then
  echo "Sync did not complete cleanly. NOT clearing legacy fitment. Fix the sync and re-run." >&2
  exit 1
fi

echo "== 3. Clear legacy fits_equipment_models where custom.fitments is set =="
if [[ "${FORCE:-0}" != "1" ]]; then
  read -rp "This permanently deletes custom.fits_equipment_models on synced products. Type 'yes' to proceed: " confirm
  if [[ "$confirm" != "yes" ]]; then
    echo "Aborted by user. Legacy fitment left intact."
    exit 0
  fi
fi
python3 "$ROOT/scripts/clear-fits-equipment-models.py" --apply

echo "Done. Run dry-run sync to verify:"
echo "  curl -X POST $FN_BASE/sync-product-fitments -H 'Content-Type: application/json' -d '{\"dry_run\":true,\"limit\":5}'"
