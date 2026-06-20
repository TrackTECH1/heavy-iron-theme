#!/usr/bin/env bash
# Consolidate fitment to custom.fitments (Supabase sync path only).
#
# Prefer:  ./scripts/fitment sync
# Once:    ./scripts/fitment setup   → writes .env.fitment.local (Shopify token + keys)
#
# Prerequisites:
#   ./scripts/fitment setup
#   npx supabase login (if service role not in .env.fitment.local)
#   shopify store auth --store tracktech-530.myshopify.com (legacy metafield cleanup only)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.fitment.local"
STORE="${SHOPIFY_STORE:-tracktech-530.myshopify.com}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-tcykyktvdlsbscrsbjyt}"
export SUPABASE_URL="${SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"
FN_BASE="${SUPABASE_URL}/functions/v1"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

extract_service_role_key() {
  python3 -c "
import sys, json
lines = [l.strip() for l in sys.stdin.read().splitlines() if l.strip()]
json_lines = [l for l in lines if l.startswith('{')]
if not json_lines:
    sys.exit(1)
data = json.loads(json_lines[-1])
for k in data.get('keys', []):
    if k.get('name') == 'service_role' or k.get('id') == 'service_role':
        print(k['api_key'])
        break
else:
    sys.exit(1)
"
}

load_service_role_key() {
  [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] && return 0

  local cli_err cli_out
  cli_err=$(mktemp)
  if ! cli_out=$(npx supabase projects api-keys --project-ref "$PROJECT_REF" 2>"$cli_err"); then
    if grep -qiE 'not logged in|access token|login required|unauthorized|401|403|invalid token|expired' "$cli_err" 2>/dev/null; then
      echo "Supabase CLI session expired — run: npx supabase login" >&2
    elif [[ -s "$cli_err" ]]; then
      echo "supabase projects api-keys failed: $(tr '\n' ' ' < "$cli_err")" >&2
    fi
    rm -f "$cli_err"
    return 1
  fi

  if ! SUPABASE_SERVICE_ROLE_KEY=$(printf '%s\n' "$cli_out" | extract_service_role_key); then
    echo "Could not parse service_role key — run: npx supabase login" >&2
    rm -f "$cli_err"
    return 1
  fi
  rm -f "$cli_err"
  export SUPABASE_SERVICE_ROLE_KEY
  echo "Loaded SUPABASE_SERVICE_ROLE_KEY via npx supabase projects api-keys"
}

echo "== 1. Backfill Shopify product GIDs in Supabase =="
if ! load_service_role_key; then
  echo "ERROR: Cannot run backfill without Supabase service role key." >&2
  echo "  Fix: ./scripts/fitment setup && npx supabase login" >&2
  exit 1
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

echo "Done. Verify:"
echo "  curl -sS -X POST $FN_BASE/sync-product-fitments -H 'Content-Type: application/json' -d '{\"dry_run\":true,\"limit\":5}' | python3 -m json.tool"
