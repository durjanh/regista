#!/usr/bin/env bash
# One-command deploy from your machine: provision with Bicep (what-if first), build the API image in ACR, roll it out
# to Container Apps, build the SPA and upload it to Azure Static Web Apps, and smoke-test. The same steps run in
# GitHub Actions (infra.yml + deploy.yml).
#
#   az login
#   scripts/deploy.sh --rg rg-regista --location uksouth --env regista [--budget-email you@example.com] [--yes]
#
# Keyless throughout: everything runs as your Entra identity; the apps use one user-assigned managed identity.
set -euo pipefail

RG="${AZURE_RESOURCE_GROUP:-rg-regista}"
LOCATION="${AZURE_LOCATION:-uksouth}"
ENV_NAME="${AZURE_ENV_NAME:-regista}"
YES=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rg) RG="$2"; shift 2 ;;
    --location) LOCATION="$2"; shift 2 ;;
    --env) ENV_NAME="$2"; shift 2 ;;
    --budget-email) export BUDGET_EMAIL="$2"; shift 2 ;;
    --yes) YES=true; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
command -v az >/dev/null || { echo "Azure CLI (az) is required" >&2; exit 1; }
az account show -o none || { echo "Run 'az login' first" >&2; exit 1; }

export AZURE_ENV_NAME="$ENV_NAME" AZURE_LOCATION="$LOCATION"
export DEPLOYER_PRINCIPAL_ID="$(az ad signed-in-user show --query id -o tsv)"
export DEPLOYER_PRINCIPAL_TYPE=User
DEPLOYMENT="regista-$(date +%Y%m%d%H%M%S)"

echo "▶ Subscription: $(az account show --query name -o tsv)  RG: $RG  Location: $LOCATION  Env: $ENV_NAME"
az group create -n "$RG" -l "$LOCATION" -o none

echo "▶ What-if"
az deployment group what-if -g "$RG" --template-file infra/main.bicep --parameters infra/main.bicepparam --result-format ResourceIdOnly
if [[ "$YES" != true ]]; then
  read -r -p "Deploy these changes? [y/N] " ok
  [[ "$ok" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 0; }
fi

# Re-runs must not revert the running API to the placeholder image: pass the current image when there is one.
current=$(az containerapp show -g "$RG" -n "${ENV_NAME}-api" --query "properties.template.containers[0].image" -o tsv 2>/dev/null || true)
keep=()
[[ -n "$current" ]] && keep=(--parameters "apiImage=$current")
echo "▶ Provision (${current:-placeholder image on the first run})"
az deployment group create -g "$RG" -n "$DEPLOYMENT" --template-file infra/main.bicep --parameters infra/main.bicepparam ${keep[@]+"${keep[@]}"} -o none
out() { az deployment group show -g "$RG" -n "$DEPLOYMENT" --query "properties.outputs.$1.value" -o tsv; }
ACR="$(out ACR_NAME)"; LOGIN="$(out ACR_LOGIN_SERVER)"
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"

echo "▶ Build the API image in ACR ($ACR, tag $TAG)"
az acr build -r "$ACR" -t "regista-api:$TAG" -f services/api/Dockerfile . -o none

echo "▶ Roll out the real image (ports, probes and the feeder command switch from the placeholder)"
az deployment group create -g "$RG" -n "$DEPLOYMENT-apps" --template-file infra/main.bicep --parameters infra/main.bicepparam \
  --parameters "apiImage=$LOGIN/regista-api:$TAG" -o none
API_URL="$(az deployment group show -g "$RG" -n "$DEPLOYMENT-apps" --query properties.outputs.API_URL.value -o tsv)"
WEB_URL="$(az deployment group show -g "$RG" -n "$DEPLOYMENT-apps" --query properties.outputs.WEB_URL.value -o tsv)"
SWA="$(az deployment group show -g "$RG" -n "$DEPLOYMENT-apps" --query properties.outputs.STATIC_WEB_APP_NAME.value -o tsv)"

echo "▶ Build the SPA against $API_URL and upload it to Static Web Apps ($SWA)"
command -v npm >/dev/null || { echo "Node.js/npm is required to build the web app" >&2; exit 1; }
(cd apps/web && npm ci --no-audit --no-fund && VITE_API_BASE_URL="$API_URL" npm run build)
SWA_TOKEN="$(az staticwebapp secrets list -n "$SWA" -g "$RG" --query properties.apiKey -o tsv)"
npx --yes @azure/static-web-apps-cli@2.0.10 deploy apps/web/dist --deployment-token "$SWA_TOKEN" --env production

echo "▶ Smoke test"
for i in $(seq 1 30); do
  if curl -fsS "$API_URL/api/health" >/dev/null 2>&1; then break; fi
  sleep 10
done
curl -fsS "$API_URL/api/health" && echo
curl -fsS "$WEB_URL/" >/dev/null && echo "web ok"

cat <<DONE

✔ Regista is live
  Web:  $WEB_URL
  API:  $API_URL/docs
  MCP:  $API_URL/mcp
  Judge mode: open $WEB_URL — no login; replays are read-only.
DONE
