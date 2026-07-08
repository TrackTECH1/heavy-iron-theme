#!/usr/bin/env bash
# One-time setup: get Shopify token → save in Supabase for sync-product-fitments
set -euo pipefail

STORE="tracktech-530.myshopify.com"
CLIENT_ID="d9f03e5dc828e0859a32c7036a382689"
PROJECT_REF="tcykyktvdlsbscrsbjyt"

echo "=== Heavy Iron: Supabase + Shopify sync setup ==="
echo ""
echo "You need your HEAVY IRON app Secret from:"
echo "  https://dev.shopify.com → Apps → HEAVY IRON → Settings → Credentials"
echo "  Click the eye icon next to Secret, then Copy."
echo ""
read -rsp "Paste Client Secret here (hidden): " CLIENT_SECRET
echo ""
echo ""

if [[ -z "${CLIENT_SECRET}" ]]; then
  echo "Error: secret was empty."
  exit 1
fi

echo "Getting access token from Shopify..."
RESP=$(curl -s -X POST "https://${STORE}/admin/oauth/access_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}")

TOKEN=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || true)

if [[ -z "${TOKEN}" ]]; then
  echo "Failed to get token. Shopify returned:"
  echo "$RESP"
  echo ""
  echo "Fix: Install HEAVY IRON on tracktech-530 in Dev Dashboard first."
  exit 1
fi

echo "Got token (Shopify accepted the credentials)."
echo ""
echo "Saving to Supabase (you may need: npx supabase login)..."

# Write secrets to a private temp env file instead of passing them as CLI args.
# CLI args are visible to any user via `ps`/proc; an --env-file (chmod 600, shredded on
# exit) keeps the admin token off the process list and out of shell history.
ENV_FILE="$(mktemp)"
chmod 600 "$ENV_FILE"
trap 'rm -f "$ENV_FILE"' EXIT
{
  printf 'SHOPIFY_STORE_DOMAIN=%s\n' "${STORE}"
  printf 'SHOPIFY_ADMIN_TOKEN=%s\n' "${TOKEN}"
  # Live fitment sync fails closed without SYNC_API_KEY. Set one here if provided.
  if [[ -n "${SYNC_API_KEY:-}" ]]; then
    printf 'SYNC_API_KEY=%s\n' "${SYNC_API_KEY}"
  fi
} > "$ENV_FILE"

npx supabase secrets set --env-file "$ENV_FILE" --project-ref "${PROJECT_REF}"
rm -f "$ENV_FILE"
trap - EXIT

if [[ -z "${SYNC_API_KEY:-}" ]]; then
  echo ""
  echo "NOTE: SYNC_API_KEY was not set, so live sync (dry_run=false) will be refused."
  echo "      Re-run with SYNC_API_KEY=... to enable live writes, e.g.:"
  echo "        SYNC_API_KEY=\"\$(openssl rand -hex 24)\" $0"
fi

echo ""
echo "Testing dry-run sync..."
curl -s -X POST "https://${PROJECT_REF}.supabase.co/functions/v1/sync-product-fitments" \
  -H "Content-Type: application/json" \
  -d '{"dry_run":true,"limit":3}'
echo ""
echo ""
echo "Done. If you see product data above (not 'Missing secrets'), it worked."
