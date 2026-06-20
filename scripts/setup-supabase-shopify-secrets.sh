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

echo "Got token (starts with ${TOKEN:0:6}...)"
echo ""
echo "Saving to Supabase (you may need: npx supabase login)..."
npx supabase secrets set \
  SHOPIFY_STORE_DOMAIN="${STORE}" \
  SHOPIFY_ADMIN_TOKEN="${TOKEN}" \
  --project-ref "${PROJECT_REF}"

echo ""
echo "Testing dry-run sync..."
curl -s -X POST "https://${PROJECT_REF}.supabase.co/functions/v1/sync-product-fitments" \
  -H "Content-Type: application/json" \
  -d '{"dry_run":true,"limit":3}'
echo ""
echo ""
echo "Done. If you see product data above (not 'Missing secrets'), it worked."
