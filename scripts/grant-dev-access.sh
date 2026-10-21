#!/usr/bin/env bash
# Gives the signed-in developer the API's data-plane roles (Foundry, Event Hubs, Storage, Cosmos DB) so the API can run
# on a laptop against the deployed resources with `az login` (DefaultAzureCredential).
#
# Bicep is the single source of truth for these roles: every provision grants them to the deploying principal with
# deterministic assignment names. Granting them here with `az role assignment create` would create the same
# assignments under random names, and the next provision would then fail with RoleAssignmentExists. So this script
# simply re-runs provisioning as you (idempotent: nothing else changes).
#
# Usage: scripts/grant-dev-access.sh            # from the repo root of an azd project (azure.yaml)
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v azd >/dev/null && azd env get-values >/dev/null 2>&1; then
  echo "▶ azd provision as $(az account show --query user.name -o tsv): grants your data-plane roles through Bicep"
  azd provision --no-prompt
else
  echo "No azd environment here. Run scripts/deploy.sh (it passes you as DEPLOYER_PRINCIPAL_ID), or 'azd env new' first." >&2
  exit 1
fi
