#!/usr/bin/env sh
# azd postprovision hook for the AKS profiles. Runs with the azd environment exported (Bicep outputs included).
#   1. Grant whoever ran azd (a user, or the pipeline's service principal) Kubernetes access through Azure RBAC.
#      Roles are assigned by *name* (no hard-coded GUID) and only if missing (deploy/hooks/role-assign.sh), so a
#      re-run never fails. Bicep never assigns these roles, so there is no duplicate under another name.
#   2. Standard profile: install cert-manager for the API's HTTPS certificate.
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
    sh "$(dirname "$0")/role-assign.sh" "$principal_id" "$principal_type" "$role" "$cluster_id"
  done
  sh "$(dirname "$0")/role-assign.sh" "$principal_id" "$principal_type" "AcrPush" "$registry_id"
else
  echo "⚠ Could not resolve the deploying principal; grant 'Azure Kubernetes Service RBAC Cluster Admin' by hand."
fi

# Standard profile: cert-manager issues the API's Let's Encrypt certificate (the SPA on Static Web Apps is HTTPS, so
# the API must be too). Pinned version; bump it deliberately. The enterprise cluster is private and its TLS ends at
# API Management, so it needs neither cert-manager nor a reachable API server from here.
CERT_MANAGER_VERSION="v1.21.2"
if [ "${DEPLOYMENT_PROFILE:-}" = "aks" ]; then
  : "${LETSENCRYPT_EMAIL:?set it first: azd env set LETSENCRYPT_EMAIL you@example.com}"
  az aks get-credentials -g "$AZURE_RESOURCE_GROUP" -n "$AZURE_AKS_CLUSTER_NAME" --overwrite-existing -o none
  kubelogin convert-kubeconfig -l azurecli
  echo "▶ cert-manager $CERT_MANAGER_VERSION"
  kubectl apply -f "https://github.com/cert-manager/cert-manager/releases/download/$CERT_MANAGER_VERSION/cert-manager.yaml"
  kubectl -n cert-manager rollout status deployment/cert-manager-webhook --timeout=300s
fi

echo "▶ Web: ${WEB_URL:-}   API: ${API_URL:-}"

# Optional Microsoft Fabric setup (only when FABRIC_WORKSPACE_NAME is set).
sh "$(dirname "$0")/fabric.sh"
