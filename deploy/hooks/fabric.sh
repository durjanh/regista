#!/usr/bin/env sh
# Optional Microsoft Fabric setup after `azd provision`, for every profile. Runs only when FABRIC_WORKSPACE_NAME is set:
#   azd env set FABRIC_WORKSPACE_NAME Regista
# Creates (find-or-create) the workspace on your Fabric trial (or FABRIC_CAPACITY_NAME), the Lakehouse with the real
# CC0 results, the Eventhouse / KQL table, the workspace identity with Event Hubs Data Receiver, the Event Hubs
# connection (workspace identity) and the Eventstream (Event Hubs -> Eventhouse). FABRIC_EVENTHUB_CONNECTION_ID is
# only for a connection you made yourself. Every step is find-or-create. See scripts/fabric-setup.py.
set -eu

if [ -z "${FABRIC_WORKSPACE_NAME:-}" ]; then
  echo "ℹ Fabric: skipped (azd env set FABRIC_WORKSPACE_NAME Regista to set up the Lakehouse, Eventhouse and Eventstream)"
  exit 0
fi

root=$(cd "$(dirname "$0")/../.." && pwd)
venv="$root/.azure/.fabric-venv"
if [ ! -x "$venv/bin/python" ]; then
  python3 -m venv "$venv"
  "$venv/bin/pip" install --quiet --disable-pip-version-check azure-identity
fi

namespace="${EVENTHUB_FQDN%%.*}"
set -- --workspace "$FABRIC_WORKSPACE_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --identity-name "$IDENTITY_NAME" \
       --eventhub-namespace "$namespace"
[ -n "${FABRIC_CAPACITY_NAME:-}" ] && set -- "$@" --capacity-name "$FABRIC_CAPACITY_NAME"
[ -n "${FABRIC_EVENTHUB_CONNECTION_ID:-}" ] && set -- "$@" --eventhub-connection-id "$FABRIC_EVENTHUB_CONNECTION_ID"
# The enterprise Event Hubs namespace is private: Fabric reaches it through a workspace managed private endpoint.
[ "${DEPLOYMENT_PROFILE:-}" = "aks-enterprise" ] && set -- "$@" --eventhub-private

echo "▶ Microsoft Fabric: workspace '$FABRIC_WORKSPACE_NAME'"
# Fabric is optional: a Fabric problem (no trial yet, tenant setting off) must not fail the Azure deployment.
if ! "$venv/bin/python" "$root/scripts/fabric-setup.py" "$@"; then
  echo "⚠ Fabric setup didn't finish (see above). The Azure deployment is fine; fix it and re-run: azd hooks run postprovision"
  exit 0
fi

# The API exports Data Forge datasets to this Lakehouse; the next `azd provision` (Container Apps) or
# `azd deploy` (AKS) passes the values to it.
if [ "${ONELAKE_WORKSPACE:-}" != "$FABRIC_WORKSPACE_NAME" ]; then
  azd env set ONELAKE_WORKSPACE "$FABRIC_WORKSPACE_NAME"
  azd env set ONELAKE_LAKEHOUSE regista_lakehouse
  echo "▶ OneLake settings stored; run 'azd provision' (Container Apps) or 'azd deploy' (AKS) once more to give them to the API."
fi
