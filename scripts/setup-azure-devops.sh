#!/usr/bin/env bash
# One-time Azure DevOps setup for .azuredevops/pipelines: a keyless service connection (workload identity
# federation), the variable group for a profile, the "regista-<profile>" environment, and the two pipelines.
# Run it signed in to the Azure subscription you will deploy to (a personal one for the hackathon).
#
# Auth: your `az login` (when the organisation is backed by the same Entra tenant), or a PAT with Service Connections,
# Variable Groups, Environment and Build (read+manage): export AZURE_DEVOPS_EXT_PAT=<PAT>
# The variable group is filled from your local azd environment of the same name (deploy/pipeline-env.txt lists the
# keys), so the pipeline provisions exactly what `azd up` did. Safe to re-run: everything is find-or-create.
#   scripts/setup-azure-devops.sh --org https://dev.azure.com/<org> --project <project> \
#       --profile aks-enterprise --rg rg-regista-ent --location uksouth --env regent \
#       --apim-email you@example.com --repo-type github --repo <owner>/<repo> --github-connection <name>
#
# Nothing here creates billable resources; `azure-dev.yml` does, after its what-if and your approval.
set -euo pipefail

ORG="" PROJECT="" PROFILE="containerapps" RG="rg-regista" LOCATION="uksouth" ENV_NAME="regista"
APIM_EMAIL="" BUDGET_EMAIL="" LE_EMAIL="" REPO_TYPE="github" REPO="" GH_CONNECTION="" CONNECTION="regista-azure"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --rg) RG="$2"; shift 2 ;;
    --location) LOCATION="$2"; shift 2 ;;
    --env) ENV_NAME="$2"; shift 2 ;;
    --apim-email) APIM_EMAIL="$2"; shift 2 ;;
    --budget-email) BUDGET_EMAIL="$2"; shift 2 ;;
    --letsencrypt-email) LE_EMAIL="$2"; shift 2 ;;
    --repo-type) REPO_TYPE="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --github-connection) GH_CONNECTION="$2"; shift 2 ;;
    --connection-name) CONNECTION="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$ORG" && -n "$PROJECT" ]] || { echo "--org and --project are required" >&2; exit 2; }
[[ "$PROFILE" =~ ^(containerapps|aks|aks-enterprise)$ ]] || { echo "--profile: containerapps | aks | aks-enterprise" >&2; exit 2; }
[[ "$PROFILE" != "aks-enterprise" || -n "$APIM_EMAIL" ]] || { echo "--apim-email is required for aks-enterprise" >&2; exit 2; }
[[ "$PROFILE" != "aks" || -n "$LE_EMAIL" ]] || { echo "--letsencrypt-email is required for aks (the API's HTTPS certificate)" >&2; exit 2; }

az extension add --name azure-devops --only-show-errors 2>/dev/null || true
# Organisation and project on every call, with auto-detection off: the git remote is GitHub, not Azure Repos.
ado() { az "$@" --org "$ORG" --project "$PROJECT" --detect false; }

SUB_ID=$(az account show --query id -o tsv)
SUB_NAME=$(az account show --query name -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
echo "▶ Subscription: $SUB_NAME ($SUB_ID). Make sure this is the subscription you mean to use."

echo "▶ Resource providers"
for ns in Microsoft.ContainerService Microsoft.ApiManagement Microsoft.Network Microsoft.App \
          Microsoft.DevOpsInfrastructure Microsoft.DevCenter Microsoft.CognitiveServices Microsoft.DocumentDB \
          Microsoft.EventHub Microsoft.ContainerRegistry Microsoft.Web Microsoft.OperationalInsights; do
  az provider register --namespace "$ns" -o none
done

echo "▶ Resource group $RG and the pipeline identity"
az group create -n "$RG" -l "$LOCATION" -o none
# Every pipeline signs in through the one service connection ($CONNECTION), whatever the profile. When it exists, its
# identity *is* the pipeline identity, so that is the one this profile's resource group must grant roles to (a
# per-profile identity would get the roles while the pipelines kept signing in as the connection's).
APP_ID=""
SE_ID=$(ado devops service-endpoint list --query "[?name=='$CONNECTION'].id | [0]" -o tsv)
[[ -n "$SE_ID" ]] && APP_ID=$(ado devops service-endpoint show --id "$SE_ID" --query "authorization.parameters.serviceprincipalid" -o tsv)
[[ -n "$APP_ID" ]] || APP_ID=$(az ad app list --display-name "regista-pipeline-$PROFILE" --query "[0].appId" -o tsv)
[[ -n "$APP_ID" ]] || APP_ID=$(az ad app create --display-name "regista-pipeline-$PROFILE" --query appId -o tsv)
echo "  identity $APP_ID ($(az ad sp show --id "$APP_ID" --query displayName -o tsv 2>/dev/null))"
SP_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv 2>/dev/null || az ad sp create --id "$APP_ID" --query id -o tsv)
RG_ID=$(az group show -n "$RG" --query id -o tsv)
# Contributor to create resources; RBAC Administrator because the templates assign roles (Contributor alone can't).
for role in "Contributor" "Role Based Access Control Administrator"; do
  sh "$(dirname "$0")/../deploy/hooks/role-assign.sh" "$SP_ID" ServicePrincipal "$role" "$RG_ID"
done

echo "▶ Service connection $CONNECTION (workload identity federation, no secret)"
PROJECT_ID=$(ado devops project show --query id -o tsv)
if [[ -z "$SE_ID" ]]; then
  cfg=$(mktemp)
  cat > "$cfg" <<JSON
{
  "name": "$CONNECTION", "type": "AzureRM", "url": "https://management.azure.com/",
  "data": { "subscriptionId": "$SUB_ID", "subscriptionName": "$SUB_NAME", "environment": "AzureCloud",
            "scopeLevel": "Subscription", "creationMode": "Manual" },
  "authorization": { "scheme": "WorkloadIdentityFederation",
                     "parameters": { "tenantid": "$TENANT_ID", "serviceprincipalid": "$APP_ID" } },
  "isShared": false, "isReady": true,
  "serviceEndpointProjectReferences": [ { "projectReference": { "id": "$PROJECT_ID", "name": "$PROJECT" }, "name": "$CONNECTION" } ]
}
JSON
  SE_ID=$(ado devops service-endpoint create --service-endpoint-configuration "$cfg" --query id -o tsv)
  rm -f "$cfg"
fi
ISSUER=$(ado devops service-endpoint show --id "$SE_ID" --query "authorization.parameters.workloadIdentityFederationIssuer" -o tsv)
SUBJECT=$(ado devops service-endpoint show --id "$SE_ID" --query "authorization.parameters.workloadIdentityFederationSubject" -o tsv)
if ! az ad app federated-credential list --id "$APP_ID" --query "[?subject=='$SUBJECT'] | [0].name" -o tsv | grep -q .; then
  az ad app federated-credential create --id "$APP_ID" --parameters \
    "{\"name\":\"azure-devops-$CONNECTION\",\"issuer\":\"$ISSUER\",\"subject\":\"$SUBJECT\",\"audiences\":[\"api://AzureADTokenExchange\"]}" -o none
fi

echo "▶ Variable group regista-$PROFILE"
vars=(AZURE_ENV_NAME="$ENV_NAME" AZURE_LOCATION="$LOCATION" AZURE_SUBSCRIPTION_ID="$SUB_ID" AZURE_RESOURCE_GROUP="$RG")
[[ -n "$BUDGET_EMAIL" ]] && vars+=(BUDGET_EMAIL="$BUDGET_EMAIL")
[[ -n "$LE_EMAIL" ]] && vars+=(LETSENCRYPT_EMAIL="$LE_EMAIL")
if [[ "$PROFILE" == "aks-enterprise" ]]; then
  DOI=$(az ad sp list --display-name DevOpsInfrastructure --query "[0].id" -o tsv)
  [[ -n "$DOI" ]] || echo "⚠ DevOpsInfrastructure service principal not found yet: register Microsoft.DevOpsInfrastructure and rerun."
  vars+=(APIM_PUBLISHER_EMAIL="$APIM_EMAIL" AZURE_DEVOPS_ORG_URL="$ORG" DEVOPS_INFRASTRUCTURE_PRINCIPAL_ID="$DOI")
fi
# Everything else `azd up` used (models, OneLake, SKUs, settings overrides) from the local azd environment, so the
# pipeline doesn't fall back to defaults. Fabric keys are left out: the pipeline principal needs Fabric access first.
project_dir="$(dirname "$0")/.."
[[ "$PROFILE" == "containerapps" ]] || project_dir="$project_dir/deploy/$PROFILE"
if azd -C "$project_dir" env list --output json 2>/dev/null | grep -q "\"Name\": \"$ENV_NAME\""; then
  while read -r key <&3; do
    case "$key" in ''|'#'*|FABRIC_WORKSPACE_NAME|FABRIC_CAPACITY_NAME|FABRIC_EVENTHUB_CONNECTION_ID) continue ;; esac
    have=""; for kv in "${vars[@]}"; do [[ "${kv%%=*}" == "$key" ]] && have=1; done
    [[ -n "$have" ]] && continue
    # A missing key exits non-zero (azd prints the error on stdout, so the exit code is what counts).
    val=$(azd -C "$project_dir" env get-value "$key" --environment "$ENV_NAME" 2>/dev/null </dev/null) || val=""
    [[ -n "$val" ]] && vars+=("$key=$val") && echo "  from azd env '$ENV_NAME': $key"
  done 3< "$(dirname "$0")/../deploy/pipeline-env.txt"
else
  echo "  ⚠ No local azd environment '$ENV_NAME' for $PROFILE: the pipeline will use the template defaults."
fi
VG_ID=$(ado pipelines variable-group list --group-name "regista-$PROFILE" --query "[0].id" -o tsv)
if [[ -z "$VG_ID" ]]; then
  VG_ID=$(ado pipelines variable-group create --name "regista-$PROFILE" --variables "${vars[@]}" --authorize true --query id -o tsv)
else
  for kv in "${vars[@]}"; do
    ado pipelines variable-group variable update --group-id "$VG_ID" --name "${kv%%=*}" --value "${kv#*=}" -o none 2>/dev/null \
      || ado pipelines variable-group variable create --group-id "$VG_ID" --name "${kv%%=*}" --value "${kv#*=}" -o none
  done
  ado pipelines variable-group update --group-id "$VG_ID" --authorize true -o none
fi

echo "▶ Environment regista-$PROFILE (deployment jobs wait on its approvals)"
envs=$(az devops invoke --org "$ORG" --detect false --area distributedtask --resource environments \
         --route-parameters project="$PROJECT" --api-version 7.1 --query "value[?name=='regista-$PROFILE'] | length(@)" -o tsv)
if [[ "$envs" == "0" ]]; then
  body=$(mktemp)
  printf '{"name":"regista-%s","description":"Regista %s: approve to provision or deploy"}' "$PROFILE" "$PROFILE" > "$body"
  az devops invoke --org "$ORG" --detect false --area distributedtask --resource environments --route-parameters project="$PROJECT" \
    --api-version 7.1 --http-method POST --in-file "$body" -o none
  rm -f "$body"
fi

echo "▶ Pipelines"
# The pipelines may use the Azure service connection without a first-run permission prompt.
ado devops service-endpoint update --id "$SE_ID" --enable-for-all true -o none
if [[ -n "$REPO" ]]; then
  extra=()
  if [[ "$REPO_TYPE" == "github" ]]; then
    # az pipelines create wants the GitHub service connection's id, not its name.
    # OAuth connections report type 'github'; Azure Pipelines (GitHub App) connections report 'GitHub'.
    GH_ID=$(ado devops service-endpoint list --query "[?name=='$GH_CONNECTION' && (type=='github' || type=='GitHub')].id | [0]" -o tsv)
    [[ -n "$GH_ID" ]] || { echo "GitHub service connection '$GH_CONNECTION' not found: Project settings > Service connections > New > GitHub" >&2; exit 1; }
    ado devops service-endpoint update --id "$GH_ID" --enable-for-all true -o none
    extra=(--service-connection "$GH_ID")
  fi
  # In the \Regista folder: the test run (automatic), the full-environment run, then one manual pipeline per part.
  for entry in "ci:Test everything" "azure-dev:Full environment" "infra:Infrastructure" "api:API" "frontend:Frontend" \
               "functions:Functions" "jobs:Container jobs"; do
    file="${entry%%:*}" name="${entry#*:}"
    ado pipelines show --name "$name" --folder-path '\Regista' -o none 2>/dev/null || \
      ado pipelines create --name "$name" --folder-path '\Regista' --yml-path ".azuredevops/pipelines/$file.yml" \
        --repository "$REPO" --repository-type "$REPO_TYPE" --branch main --skip-first-run true ${extra[@]+"${extra[@]}"} -o none
  done
else
  echo "  --repo not given: create pipelines from .azuredevops/pipelines/ci.yml and azure-dev.yml in the portal."
fi

cat <<EOF

Done. In Azure DevOps:
  1. Pipelines > Environments > regista-$PROFILE > Approvals and checks: add yourself,
     so every Provision and Deploy waits for a person to read the what-if.
  2. First time: run Regista > "Full environment" with profile=$PROFILE (everything). After that, run the pipeline
     of the part you want to deploy: Infrastructure, API, Frontend, Functions, Container jobs (each independent).
EOF
# An if, not `[[ ]] && echo`: as the last command, a false test would make the script exit 1 (and stop deploy-env.sh).
if [[ "$PROFILE" == "aks-enterprise" ]]; then
  echo "  3. Run Infrastructure before Full environment: it creates the agent pool regista-mdp the deploy stages use."
fi
