#!/usr/bin/env bash
# One-command deploy from your machine: provision with Bicep (what-if first), build both images in ACR,
# roll them out to Container Apps, and smoke-test. The same steps run in GitHub Actions (infra.yml + deploy.yml).
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

echo "▶ Provision (placeholder images on the first run)"
az deployment group create -g "$RG" -n "$DEPLOYMENT" --template-file infra/main.bicep --parameters infra/main.bicepparam -o none
out() { az deployment group show -g "$RG" -n "$DEPLOYMENT" --query "properties.outputs.$1.value" -o tsv; }
ACR="$(out ACR_NAME)"; LOGIN="$(out ACR_LOGIN_SERVER)"
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"

echo "▶ Build images in ACR ($ACR, tag $TAG)"
az acr build -r "$ACR" -t "regista-api:$TAG" -f services/api/Dockerfile . -o none
az acr build -r "$ACR" -t "regista-web:$TAG" -f apps/web/Dockerfile apps/web -o none

echo "▶ Roll out the real images (ports, probes and the feeder command switch from the placeholder)"
az deployment group create -g "$RG" -n "$DEPLOYMENT-apps" --template-file infra/main.bicep --parameters infra/main.bicepparam \
  --parameters "apiImage=$LOGIN/regista-api:$TAG" "webImage=$LOGIN/regista-web:$TAG" -o none
API_URL="$(az deployment group show -g "$RG" -n "$DEPLOYMENT-apps" --query properties.outputs.API_URL.value -o tsv)"
WEB_URL="$(az deployment group show -g "$RG" -n "$DEPLOYMENT-apps" --query properties.outputs.WEB_URL.value -o tsv)"

echo "▶ Smoke test"
for i in $(seq 1 30); do
  if curl -fsS "$API_URL/api/health" >/dev/null 2>&1; then break; fi
  sleep 10
done
curl -fsS "$API_URL/api/health" && echo
curl -fsS "$WEB_URL/healthz" >/dev/null && echo "web ok"

cat <<DONE

✔ Regista is live
  Web:  $WEB_URL
  API:  $API_URL/docs
  MCP:  $API_URL/mcp
  Judge mode: open $WEB_URL — no login; replays are read-only.
DONE
