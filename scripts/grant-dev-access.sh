#!/usr/bin/env bash
# Grants the signed-in developer the same data-plane roles as the workload identity, so the API can
# run on a laptop against the deployed Azure resources with `az login` (DefaultAzureCredential).
# Idempotent. Does not redeploy anything.
#
# Usage: scripts/grant-dev-access.sh --rg rg-regista [--env regista] [--principal <object-id>]

set -euo pipefail

RG=""
ENV_NAME="regista"
PRINCIPAL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rg) RG="$2"; shift 2 ;;
    --env) ENV_NAME="$2"; shift 2 ;;
    --principal) PRINCIPAL="$2"; shift 2 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
[[ -n "$RG" ]] || { echo "--rg is required" >&2; exit 1; }

PRINCIPAL=${PRINCIPAL:-$(az ad signed-in-user show --query id -o tsv)}
out() { az deployment group show -g "$RG" -n main --query "properties.outputs.$1.value" -o tsv; }

AI_ID=$(out AZURE_AI_SERVICES_RESOURCE_ID)
EH_ID=$(az eventhubs namespace list -g "$RG" --query "[0].id" -o tsv)
ST_ID=$(az storage account list -g "$RG" --query "[0].id" -o tsv)
COSMOS_NAME=$(az cosmosdb list -g "$RG" --query "[0].name" -o tsv)

grant() {
  local role="$1" scope="$2"
  if [[ $(az role assignment list --assignee "$PRINCIPAL" --scope "$scope" --role "$role" --query "length(@)" -o tsv) == "0" ]]; then
    az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type User --role "$role" --scope "$scope" -o none
    echo "Granted $role"
  else
    echo "Already has $role"
  fi
}

# Role ids verified on Microsoft Learn (Azure built-in roles).
grant "5e0bd9bd-7b93-4f28-af87-19fc36ad61bd" "$AI_ID"   # Cognitive Services OpenAI User
grant "a97b65f3-24c7-4388-baec-2e87135dc908" "$AI_ID"   # Cognitive Services User (Speech, Translator, Content Safety)
grant "53ca6127-db72-4b80-b1b0-d745d6d5456d" "$AI_ID"   # Foundry User (agents, evaluations)
grant "2b629674-e913-4c01-ae53-ef4638d8f975" "$EH_ID"   # Azure Event Hubs Data Sender
grant "a638d3c7-ab3a-418d-83e6-5f17a39d4fde" "$EH_ID"   # Azure Event Hubs Data Receiver
grant "ba92f5b4-2d11-453d-a403-e96b0029c9fe" "$ST_ID"   # Storage Blob Data Contributor

# Cosmos DB Built-in Data Contributor (Cosmos native RBAC, not Azure RBAC).
COSMOS_ID=$(az cosmosdb show -g "$RG" -n "$COSMOS_NAME" --query id -o tsv)
if [[ $(az cosmosdb sql role assignment list -g "$RG" -a "$COSMOS_NAME" --query "[?principalId=='$PRINCIPAL'] | length(@)" -o tsv) == "0" ]]; then
  az cosmosdb sql role assignment create -g "$RG" -a "$COSMOS_NAME" \
    --role-definition-id 00000000-0000-0000-0000-000000000002 \
    --principal-id "$PRINCIPAL" --scope "$COSMOS_ID" -o none
  echo "Granted Cosmos DB Built-in Data Contributor"
else
  echo "Already has Cosmos DB data access"
fi

cat <<EOF

Done. Role assignments can take a few minutes to propagate.
Export these for services/api (or put them in services/api/.env):

AZURE_OPENAI_ENDPOINT=$(out AZURE_OPENAI_ENDPOINT)
FOUNDRY_PROJECT_ENDPOINT=$(out FOUNDRY_PROJECT_ENDPOINT)
AZURE_AI_SERVICES_ENDPOINT=$(out AZURE_AI_SERVICES_ENDPOINT)
AZURE_AI_SERVICES_REGION=$(out AZURE_LOCATION)
AZURE_AI_SERVICES_RESOURCE_ID=$AI_ID
AZURE_OPENAI_CHAT_DEPLOYMENT=chat
AZURE_OPENAI_REASONING_DEPLOYMENT=reasoning
COSMOS_ENDPOINT=$(out COSMOS_ENDPOINT)
STORAGE_ACCOUNT_URL=$(out STORAGE_ACCOUNT_URL)
EVENTHUB_FQDN=$(out EVENTHUB_FQDN)
EVENTHUB_NAME=$(out EVENTHUB_NAME)
EOF
