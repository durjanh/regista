#!/usr/bin/env sh
# azd postdeploy hook for every profile: smoke-test the API and the Static Web App.
#   containerapps   API on its Container Apps URL
#   aks             API on its stable hostname over HTTPS; the certificate can take a minute or two to issue
#   aks-enterprise  API Management gateway (deploy runs on the in-VNet agent; the gateway is public)
set -eu

api="${API_URL:-}"
web="${WEB_URL:-}"
[ -n "$api" ] || { echo "⚠ API_URL not set; skipping the smoke test."; exit 0; }

# Container Apps: the first deploy still has the placeholder image's port and probes; switch them over first.
if [ "${DEPLOYMENT_PROFILE:-}" = "containerapps" ]; then
  "$(dirname "$0")/containerapps-rollout.sh"
fi

echo "▶ Smoke test $api/api/health"
ok=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 "$api/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 10
done
[ -n "$ok" ] || { echo "✖ $api/api/health did not answer within 5 minutes" >&2; exit 1; }

if [ -n "$web" ]; then
  # CORS: the API must accept the Static Web App's origin, or the browser blocks every call.
  allowed=$(curl -fsS --max-time 10 -H "Origin: $web" -D - -o /dev/null "$api/api/health" | tr -d '\r' | \
            awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')
  [ "$allowed" = "$web" ] || [ "$allowed" = "*" ] || { echo "✖ CORS: API does not allow $web (got '${allowed:-none}')" >&2; exit 1; }
  curl -fsS --max-time 10 -o /dev/null "$web/" || { echo "✖ $web did not answer" >&2; exit 1; }
fi
echo "✔ Regista is live: $web  (API $api)"
