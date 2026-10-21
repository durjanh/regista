#!/usr/bin/env sh
# azd postprovision hook for the AKS profiles. Runs with the azd environment exported (Bicep outputs included).
#   1. Grant whoever ran azd (a user, or the pipeline's service principal) Kubernetes access through Azure RBAC.
#      Roles are assigned by *name* here, so no role-definition GUID is hard-coded; `az role assignment create`
#      is idempotent.
set -eu

: "${AZURE_AKS_CLUSTER_NAME:?run azd provision first}"
: "${AZURE_RESOURCE_GROUP:?}"
: "${AZURE_CONTAINER_REGISTRY_NAME:?}"

cluster_id=$(az aks show -g "$AZURE_RESOURCE_GROUP" -n "$AZURE_AKS_CLUSTER_NAME" --query id -o tsv)
registry_id=$(az acr show -n "$AZURE_CONTAINER_REGISTRY_NAME" --query id -o tsv)

principal_id="${AZURE_PRINCIPAL_ID:-}"
principal_type="${AZURE_PRINCIPAL_TYPE:-User}"
if [ -z "$principal_id" ]; then
  principal_id=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)
fi

if [ -n "$principal_id" ]; then
  echo "▶ Kubernetes and registry access for $principal_type $principal_id"
  for role in "Azure Kubernetes Service RBAC Cluster Admin" "Azure Kubernetes Service Cluster User Role"; do
    az role assignment create --assignee-object-id "$principal_id" --assignee-principal-type "$principal_type" \
      --role "$role" --scope "$cluster_id" -o none
  done
  az role assignment create --assignee-object-id "$principal_id" --assignee-principal-type "$principal_type" \
    --role "AcrPush" --scope "$registry_id" -o none
else
  echo "⚠ Could not resolve the deploying principal; grant 'Azure Kubernetes Service RBAC Cluster Admin' by hand."
fi

if [ "${DEPLOYMENT_PROFILE:-}" = "aks-enterprise" ]; then
  echo "▶ Public URL (API Management gateway; live after 'azd deploy' from the in-VNet agent): ${REGISTA_PUBLIC_URL:-}"
fi
