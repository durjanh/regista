#!/usr/bin/env sh
# First rollout on Container Apps. The first `azd provision` runs before any image is in the registry, so Bicep creates
# the API with the placeholder image's configuration (port 80, no probes, placeholder feeder command). `azd deploy`
# then swaps only the image, and the API, listening on 8000, never passes its startup probe. Once the real image is
# deployed, re-apply the template with it so ports, probes and the feeder command switch over (as scripts/deploy.sh
# and the GitHub workflow do). Later runs find port 8000 already and change nothing.
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
rg="${AZURE_RESOURCE_GROUP:?}"
app=$(az containerapp list -g "$rg" --query "[?tags.\"azd-service-name\"=='api'].name | [0]" -o tsv)
[ -n "$app" ] || exit 0

port=$(az containerapp show -n "$app" -g "$rg" --query properties.configuration.ingress.targetPort -o tsv)
image=$(az containerapp show -n "$app" -g "$rg" --query "properties.template.containers[0].image" -o tsv)
[ "$port" = "8000" ] && exit 0
case "$image" in mcr.microsoft.com/k8se/quickstart*) exit 0 ;; esac   # nothing of ours deployed yet

echo "▶ First rollout: applying the API configuration for $image (port 8000, probes, feeder command)"
export SERVICE_API_IMAGE_NAME="$image"
# azd passes AZURE_PRINCIPAL_ID to its own deployment but doesn't store it; keep the deployer's roles in this one.
if [ -z "${AZURE_PRINCIPAL_ID:-}" ] && [ "${AZURE_PRINCIPAL_TYPE:-User}" = "User" ]; then
  AZURE_PRINCIPAL_ID=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)
  export AZURE_PRINCIPAL_ID
fi
az deployment group create -g "$rg" -n "regista-first-rollout" \
  --template-file "$root/infra/main.bicep" --parameters "$root/infra/main.bicepparam" -o none
echo "✔ API configuration applied"
