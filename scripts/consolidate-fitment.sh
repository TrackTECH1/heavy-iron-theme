#!/usr/bin/env bash
# Consolidate fitment to custom.fitments (Supabase sync path only).
#
# Prerequisites:
#   shopify store auth --store tracktech-530.myshopify.com
#   npx supabase login   (for auto SUPABASE_SERVICE_ROLE_KEY; re-run if session expired)
#   Deployed edge functions on the Supabase project
#
# Service-role key loading:
#   - Uses `npx supabase projects api-keys` when SUPABASE_SERVICE_ROLE_KEY is unset
#   - Captures stderr separately (auth errors are not hidden)
#   - Strips npm warn lines from stdout; parses JSON from the last line starting with '{'
#   - Matches service_role by id or name
#   - Or set SUPABASE_SERVICE_ROLE_KEY manually to skip CLI lookup
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORE="${SHOPIFY_STORE:-tracktech-530.myshopify.com}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-tcykyktvdlsbscrsbjyt}"
export SUPABASE_URL="${SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"
FN_BASE="${SUPABASE_URL}/functions/v1"

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
    else
      echo "supabase projects api-keys failed (exit $?)" >&2
    fi
    rm -f "$cli_err"
    return 1
  fi

  if ! SUPABASE_SERVICE_ROLE_KEY=$(printf '%s\n' "$cli_out" | extract_service_role_key); then
    if grep -qiE 'not logged in|access token|login required|unauthorized|401|403|invalid token|expired' "$cli_err" 2>/dev/null; then
      echo "Supabase CLI session expired — run: npx supabase login" >&2
    elif [[ -z "$cli_out" ]]; then
      echo "supabase projects api-keys returned no output — run: npx supabase login" >&2
      [[ -s "$cli_err" ]] && echo "stderr: $(tr '\n' ' ' < "$cli_err")" >&2
    else
      echo "Could not parse service_role key from supabase projects api-keys output" >&2
    fi
    rm -f "$cli_err"
    return 1
  fi
  rm -f "$cli_err"

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
