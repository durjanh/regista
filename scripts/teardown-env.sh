#!/usr/bin/env bash
# Tear a Regista environment down completely: delete its resource group and purge what Azure keeps in its recycle bin
# (Foundry/AI Services accounts and API Management), so the same names can be reused straight away.
#   scripts/teardown-env.sh --profile aks-enterprise
#   scripts/teardown-env.sh --profile aks
#   scripts/teardown-env.sh --profile containerapps
# Azure DevOps (service connection, variable groups, pipelines) is kept: scripts/deploy-env.sh restores the resource
# group and the pipeline identity's roles, which go with the group.
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="" SUBSCRIPTION="c79c28af-1f06-4846-9d89-0a2786eb6dc3"   # FootballHackathon
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --subscription) SUBSCRIPTION="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$PROFILE" in
  containerapps)  DIR="."                     ENV="regista" RG="rg-regista" ;;
  aks)            DIR="deploy/aks"            ENV="regaks"  RG="rg-regista-aks" ;;
  aks-enterprise) DIR="deploy/aks-enterprise" ENV="regse"   RG="rg-regista-ent-se" ;;
  *) echo "--profile: containerapps | aks | aks-enterprise" >&2; exit 2 ;;
esac
az account set --subscription "$SUBSCRIPTION"

if [[ "$(az group exists -n "$RG")" == "true" ]]; then
  echo "▶ Deleting $RG ($PROFILE) with azd down --purge (20-40 minutes)"
  azd -C "$DIR" env refresh -e "$ENV" >/dev/null 2>&1 || true
  azd -C "$DIR" down --purge --force -e "$ENV"
else
  echo "▶ $RG doesn't exist"
fi

# azd's purge has missed soft-deleted Foundry accounts before (it can run while the group is still deleting).
echo "▶ Recycle bin"
for name in $(az cognitiveservices account list-deleted --query "[?contains(id, '/resourceGroups/$RG/')].name" -o tsv); do
  loc=$(az cognitiveservices account list-deleted --query "[?name=='$name'].location | [0]" -o tsv)
  az cognitiveservices account purge -l "$loc" -g "$RG" -n "$name" && echo "  purged AI account $name"
done
for name in $(az apim deletedservice list --query "[?contains(serviceId, '/resourceGroups/$RG/')].name" -o tsv 2>/dev/null); do
  loc=$(az apim deletedservice list --query "[?name=='$name'].location | [0]" -o tsv 2>/dev/null)
  az apim deletedservice purge --service-name "$name" --location "$loc" 2>/dev/null && echo "  purged API Management $name"
done
echo "▶ Done: $RG is gone and nothing of it is left in the recycle bin"
