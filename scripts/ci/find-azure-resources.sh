#!/usr/bin/env bash
# Print the deployed resources of a resource group as key=value lines (for $GITHUB_OUTPUT or eval). Resources are
# found by tag and type, never by deployment name, so this works however the environment was provisioned (azd, Azure
# Pipelines, the GitHub Infrastructure workflow). Missing resources print an empty value.
#   scripts/ci/find-azure-resources.sh rg-regista
set -euo pipefail
rg="${1:?resource group}"
export AZURE_EXTENSION_USE_DYNAMIC_INSTALL=yes_without_prompt
q() { az "$@" -o tsv 2>/dev/null || true; }

api_app=$(q containerapp list -g "$rg" --query "[?tags.\"azd-service-name\"=='api'].name | [0]")
api_fqdn=""; api_image=""
if [ -n "$api_app" ]; then
  api_fqdn=$(q containerapp show -g "$rg" -n "$api_app" --query properties.configuration.ingress.fqdn)
  api_image=$(q containerapp show -g "$rg" -n "$api_app" --query "properties.template.containers[0].image")
fi
swa=$(q staticwebapp list -g "$rg" --query "[0].name")
swa_host=""; [ -n "$swa" ] && swa_host=$(q staticwebapp show -g "$rg" -n "$swa" --query defaultHostname)

# The signed-in principal's object id, from its own token (no Graph permission needed): Bicep grants it data roles.
token=$(az account get-access-token --query accessToken -o tsv)
deployer=$(python3 -c "import base64,json,sys; p=sys.argv[1].split('.')[1]; p+='='*(-len(p)%4); print(json.loads(base64.urlsafe_b64decode(p))['oid'])" "$token")

echo "acr=$(q acr list -g "$rg" --query "[0].name")"
echo "login_server=$(q acr list -g "$rg" --query "[0].loginServer")"
echo "api_app=$api_app"
echo "api_url=${api_fqdn:+https://$api_fqdn}"
echo "api_image=$api_image"
echo "feeder_job=$(q containerapp job list -g "$rg" --query "[0].name")"
echo "static_web_app=$swa"
echo "web_url=${swa_host:+https://$swa_host}"
echo "function_app=$(q functionapp list -g "$rg" --query "[0].name")"
echo "deployer=$deployer"
