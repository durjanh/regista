#!/usr/bin/env bash
# One-time bootstrap: connects this GitHub repo to Azure with OpenID Connect (no secrets stored).
#
#   1. Creates the resource group.
#   2. Creates an Entra app + service principal for GitHub Actions.
#   3. Adds federated credentials for: main branch, pull requests, and the `production` environment.
#   4. Grants Contributor + Role Based Access Control Administrator on the resource group only.
#   5. Writes repo secrets and variables with the GitHub CLI.
#   6. Creates the `production` GitHub environment.
#
# Idempotent: safe to re-run. Requires: az (logged in), gh (logged in), jq.
#
# Usage:
#   scripts/bootstrap-github-oidc.sh [--repo owner/name] [--rg rg-regista] [--location uksouth] [--env regista]

set -euo pipefail

REPO=""
RG="rg-regista"
LOCATION="uksouth"
ENV_NAME="regista"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --rg) RG="$2"; shift 2 ;;
    --location) LOCATION="$2"; shift 2 ;;
    --env) ENV_NAME="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

for tool in az gh jq; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

az account show >/dev/null 2>&1 || { echo "Run 'az login' first." >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }

if [[ -z "$REPO" ]]; then
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
fi

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
APP_NAME="gh-${REPO//\//-}-${ENV_NAME}"

echo "Repository:     $REPO"
echo "Subscription:   $SUBSCRIPTION_ID"
echo "Resource group: $RG ($LOCATION)"
echo "Entra app:      $APP_NAME"
echo

# 1. Resource group -----------------------------------------------------------------------------
az group create --name "$RG" --location "$LOCATION" --tags project=regista azd-env-name="$ENV_NAME" -o none
RG_ID=$(az group show --name "$RG" --query id -o tsv)

# 2. Entra app + service principal --------------------------------------------------------------
APP_ID=$(az ad app list --display-name "$APP_NAME" --query "[0].appId" -o tsv)
if [[ -z "$APP_ID" ]]; then
  APP_ID=$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)
  echo "Created app registration $APP_ID"
else
  echo "Reusing app registration $APP_ID"
fi

SP_ID=$(az ad sp list --filter "appId eq '$APP_ID'" --query "[0].id" -o tsv)
if [[ -z "$SP_ID" ]]; then
  SP_ID=$(az ad sp create --id "$APP_ID" --query id -o tsv)
  echo "Created service principal $SP_ID"
fi

# 3. Federated credentials (GitHub OIDC) --------------------------------------------------------
add_federated_credential() {
  local name="$1" subject="$2"
  if az ad app federated-credential list --id "$APP_ID" --query "[?name=='$name'] | length(@)" -o tsv | grep -q '^1$'; then
    echo "Federated credential '$name' already exists"
    return
  fi
  az ad app federated-credential create --id "$APP_ID" --parameters "$(jq -n \
    --arg name "$name" --arg subject "$subject" \
    '{name: $name, issuer: "https://token.actions.githubusercontent.com", subject: $subject, audiences: ["api://AzureADTokenExchange"]}')" -o none
  echo "Added federated credential '$name' → $subject"
}

# GitHub's token subject names the repository either as owner/repo or, for newer repositories, with immutable ids
# (repo:owner@<owner id>/repo@<repo id>:...). Register both forms so either one signs in.
OWNER_ID=$(gh api "repos/${REPO}" --jq .owner.id)
REPO_ID=$(gh api "repos/${REPO}" --jq .id)
IMMUTABLE="${REPO%%/*}@${OWNER_ID}/${REPO#*/}@${REPO_ID}"
add_federated_credential "main" "repo:${REPO}:ref:refs/heads/main"
add_federated_credential "pull-request" "repo:${REPO}:pull_request"
add_federated_credential "env-production" "repo:${REPO}:environment:production"
add_federated_credential "main-ids" "repo:${IMMUTABLE}:ref:refs/heads/main"
add_federated_credential "pull-request-ids" "repo:${IMMUTABLE}:pull_request"
add_federated_credential "env-production-ids" "repo:${IMMUTABLE}:environment:production"

# 4. Role assignments (scoped to the resource group) --------------------------------------------
assign_role() {
  local role="$1"
  if [[ $(az role assignment list --assignee "$SP_ID" --scope "$RG_ID" --role "$role" --query "length(@)" -o tsv) == "0" ]]; then
    # Role propagation for new service principals can lag; retry a few times.
    for attempt in 1 2 3 4 5; do
      if az role assignment create --assignee-object-id "$SP_ID" --assignee-principal-type ServicePrincipal \
          --role "$role" --scope "$RG_ID" -o none 2>/dev/null; then
        echo "Assigned '$role' on $RG"
        return
      fi
      echo "Waiting for the service principal to propagate (attempt $attempt)…"; sleep 15
    done
    echo "Could not assign '$role'" >&2; exit 1
  else
    echo "'$role' already assigned"
  fi
}

# Contributor creates resources; RBAC Administrator lets Bicep create the managed identity's role
# assignments (Foundry, Event Hubs, Storage, ACR, App Insights).
assign_role "Contributor"
assign_role "Role Based Access Control Administrator"

# 5. GitHub secrets and variables (GitHub CLI) --------------------------------------------------
gh secret set AZURE_CLIENT_ID --repo "$REPO" --body "$APP_ID"
gh secret set AZURE_TENANT_ID --repo "$REPO" --body "$TENANT_ID"
gh secret set AZURE_SUBSCRIPTION_ID --repo "$REPO" --body "$SUBSCRIPTION_ID"
gh variable set AZURE_RESOURCE_GROUP --repo "$REPO" --body "$RG"
gh variable set AZURE_LOCATION --repo "$REPO" --body "$LOCATION"
gh variable set AZURE_ENV_NAME --repo "$REPO" --body "$ENV_NAME"
# Everything else `azd up` used (models, OneLake, SKUs, settings overrides) from the local azd environment, so the
# workflows provision exactly the same thing (deploy/pipeline-env.txt lists the keys; Fabric keys are left out).
if azd -C "$(dirname "$0")/.." env list --output json 2>/dev/null | grep -q "\"Name\": \"$ENV_NAME\""; then
  while read -r key <&3; do
    case "$key" in ''|'#'*|FABRIC_WORKSPACE_NAME|FABRIC_CAPACITY_NAME|FABRIC_EVENTHUB_CONNECTION_ID) continue ;; esac
    val=$(azd -C "$(dirname "$0")/.." env get-value "$key" --environment "$ENV_NAME" 2>/dev/null </dev/null) || continue
    [ -n "$val" ] && gh variable set "$key" --repo "$REPO" --body "$val" </dev/null && echo "Variable $key from azd env '$ENV_NAME'"
  done 3< "$(dirname "$0")/../deploy/pipeline-env.txt"
fi

# 6. GitHub environment -------------------------------------------------------------------------
# Every deployment waits for a person: you are the required reviewer (public repos and paid plans).
ME=$(gh api user --jq .id)
gh api --method PUT "repos/${REPO}/environments/production" --input - >/dev/null <<JSON
{"reviewers": [{"type": "User", "id": $ME}], "deployment_branch_policy": null}
JSON
echo "Ensured GitHub environment 'production' (required reviewer: $(gh api user --jq .login))"

cat <<EOF

Done. Next steps:
  1. Infrastructure (Bicep only):       gh workflow run infra.yml --repo $REPO
  2. Everything else, once:             gh workflow run deploy.yml --repo $REPO
     After that each part deploys on its own when its code changes: deploy-api, deploy-frontend,
     deploy-functions, and deploy-jobs (after each API deploy). Approve each run in the Actions tab.
  3. Watch progress:                    gh run watch --repo $REPO
  4. (Optional) Fabric:                 python scripts/fabric-setup.py --help

For local development against Azure (after the Infrastructure workflow has run), grant yourself
data-plane roles without redeploying:
  scripts/grant-dev-access.sh --rg $RG
EOF
