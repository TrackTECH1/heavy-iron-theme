#!/usr/bin/env bash
# One-time setup: get Shopify token → save in Supabase for sync-product-fitments
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/fitment-env.sh
source "$ROOT/scripts/lib/fitment-env.sh"

FROM_ENV=0
for arg in "$@"; do
  case "$arg" in
    --from-env) FROM_ENV=1 ;;
    -h|--help)
      cat <<EOF
Usage: ./scripts/fitment setup [--from-env]

  --from-env   Read SHOPIFY_CLIENT_SECRET from the environment (non-interactive)

Env:
  SHOPIFY_CLIENT_SECRET   HEAVY IRON app Client Secret (shpss_...)
EOF
      exit 0
      ;;
  esac
done

normalize_client_secret() {
  local secret="$1"
  secret="${secret//$'\r'/}"
  secret="${secret//$'\n'/}"
  secret="${secret#"${secret%%[![:space:]]*}"}"
  secret="${secret%"${secret##*[![:space:]]}"}"
  printf '%s' "$secret"
}

validate_client_secret_input() {
  local secret="$1"

  if [[ -z "$secret" ]]; then
    echo "Error: secret was empty." >&2
    echo "  Paste only the Client Secret value — not the command line or comments." >&2
    exit 1
  fi

  if [[ "$secret" == *"#"* ]] || [[ "$secret" == *"export "* ]] || [[ "$secret" == *"CLIENT_SECRET="* ]]; then
    echo "Error: input looks like shell command text, not the secret." >&2
    echo "  Paste only the secret from Dev Dashboard (eye icon → Copy)." >&2
    echo "  Do not paste lines like: export SHOPIFY_CLIENT_SECRET=..." >&2
    exit 1
  fi

  if [[ "$secret" == shpat_* ]]; then
    echo "Error: that looks like an Admin API access token (shpat_), not the Client Secret." >&2
    echo "  Use: Dev Dashboard → HEAVY IRON → Settings → Credentials → Secret (shpss_...)" >&2
    exit 1
  fi

  if [[ "$secret" == "$FITMENT_CLIENT_ID" ]] || [[ "$secret" =~ ^[a-f0-9]{32}$ ]]; then
    echo "Error: that looks like the Client ID, not the Client Secret." >&2
    echo "  Client ID is the hex string shown as \"Client ID\"." >&2
    echo "  You need \"Secret\" (usually starts with shpss_) — click the eye icon, then Copy." >&2
    exit 1
  fi

  if [[ "$secret" != shpss_* ]]; then
    echo "Warning: Client Secret usually starts with shpss_. Double-check you copied Secret, not Client ID." >&2
  fi
}

parse_shopify_token_response() {
  local resp="$1"
  python3 -c "
import json, sys

raw = sys.argv[1].strip()
if not raw:
    print('empty'); sys.exit(0)
if raw.lstrip().startswith('<'):
    low = raw.lower()
    if 'invalid client' in low or 'client secret' in low:
        print('invalid_secret')
    elif 'not found' in low or 'oauth' in low:
        print('html_error')
    else:
        print('html_error')
    sys.exit(0)
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print('not_json')
    sys.exit(0)
err = data.get('error') or data.get('error_description') or ''
token = data.get('access_token') or ''
if token:
    print('ok')
    print(token)
elif err:
    low = str(err).lower()
    if 'client' in low and 'secret' in low:
        print('invalid_secret')
    else:
        print('oauth_error')
        print(err)
else:
    print('no_token')
" "$resp"
}

read_client_secret() {
  if [[ "$FROM_ENV" -eq 1 ]]; then
    if [[ -z "${SHOPIFY_CLIENT_SECRET:-}" ]]; then
      echo "Error: SHOPIFY_CLIENT_SECRET is not set." >&2
      echo "  Example: SHOPIFY_CLIENT_SECRET='shpss_...' ./scripts/fitment setup --from-env" >&2
      exit 1
    fi
    normalize_client_secret "$SHOPIFY_CLIENT_SECRET"
    return 0
  fi

  echo "=== Heavy Iron: Supabase + Shopify sync setup ==="
  echo ""
  echo "You need the HEAVY IRON app Client Secret from:"
  echo "  https://dev.shopify.com → Apps → HEAVY IRON → Settings → Credentials"
  echo "  Click the eye icon next to Secret, then Copy."
  echo ""
  echo "Important:"
  echo "  - Paste ONLY the secret value (usually starts with shpss_)"
  echo "  - Do NOT paste Client ID (32-character hex string)"
  echo "  - Do NOT paste command lines or comments (no # or export ...)"
  echo ""
  read -rsp "Paste Client Secret here (hidden): " CLIENT_SECRET
  echo ""
  echo ""
  normalize_client_secret "$CLIENT_SECRET"
}

CLIENT_SECRET=$(read_client_secret)
validate_client_secret_input "$CLIENT_SECRET"

echo "Getting access token from Shopify..."
RESP=$(curl -sS -X POST "https://${FITMENT_STORE}/admin/oauth/access_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=${FITMENT_CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}")

PARSE_OUT=$(parse_shopify_token_response "$RESP")
PARSE_STATUS=$(printf '%s\n' "$PARSE_OUT" | head -1)
TOKEN=$(printf '%s\n' "$PARSE_OUT" | sed -n '2p')

case "$PARSE_STATUS" in
  ok)
    ;;
  invalid_secret)
    echo "Failed: Shopify rejected the Client Secret (missing or invalid)." >&2
    echo "  Fix: copy Secret again from Dev Dashboard — not Client ID, not an access token." >&2
    exit 1
    ;;
  html_error|not_json|no_token|oauth_error|empty)
    echo "Failed to get token from Shopify." >&2
    if [[ "$PARSE_STATUS" == oauth_error && -n "$TOKEN" ]]; then
      echo "  Shopify error: $TOKEN" >&2
    elif [[ "$RESP" == *"<"* ]]; then
      echo "  Shopify returned an HTML error page (app may not be installed on ${FITMENT_STORE})." >&2
      echo "  Fix: install HEAVY IRON on ${FITMENT_STORE} in Dev Dashboard, then retry." >&2
    else
      echo "  Response: $RESP" >&2
    fi
    exit 1
    ;;
  *)
    echo "Failed to get token. Shopify returned:" >&2
    echo "$RESP" >&2
    exit 1
    ;;
esac

echo "Got token (starts with ${TOKEN:0:6}...)"
echo ""
echo "Saving to Supabase (you may need: npx supabase login)..."
npx supabase secrets set \
  SHOPIFY_STORE_DOMAIN="${FITMENT_STORE}" \
  SHOPIFY_ADMIN_TOKEN="${TOKEN}" \
  --project-ref "${FITMENT_PROJECT_REF}"

SERVICE_KEY=""
if load_service_role_key; then
  SERVICE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
  echo "Loaded SUPABASE_SERVICE_ROLE_KEY via Supabase CLI"
else
  echo "Warning: could not load service role key — .env.fitment.local will omit it." >&2
  echo "  Run: npx supabase login && ./scripts/fitment bootstrap" >&2
fi

write_fitment_env_file "$TOKEN" "$SERVICE_KEY"
echo "Wrote local credentials → .env.fitment.local (gitignored)"

echo ""
echo "Testing dry-run sync..."
curl -sS -X POST "${SUPABASE_URL}/functions/v1/sync-product-fitments" \
  -H "Content-Type: application/json" \
  -d '{"dry_run":true,"limit":3}'
echo ""
echo ""
echo "Done. Next: ./scripts/fitment sync"
