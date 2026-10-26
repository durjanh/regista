#!/usr/bin/env bash
# One command to bring a Regista environment up through Azure DevOps, from nothing (after a teardown) or to refresh it.
#   scripts/deploy-env.sh --profile containerapps  --email you@example.com
#   scripts/deploy-env.sh --profile aks            --email you@example.com
#   scripts/deploy-env.sh --profile aks-enterprise --email you@example.com [--fabric]
# Steps, each safe to re-run:
#   1. the local azd environment and its settings (models, video-safe mode, emails, ...)
#   2. scripts/setup-azure-devops.sh: resource group, the pipeline identity's roles, variable group, environment
#   3. enterprise only: the pipeline identity's Azure DevOps permissions to create and update the in-VNet agent pool
#   4. the pipelines (enterprise: Infrastructure, then Full environment; others: Full environment), waiting for each.
#      Approve the what-if in Azure DevOps when a run pauses on the regista-<profile> environment.
#   5. --fabric: the Fabric step from this machine (the pipelines skip it); run it for Container Apps last
#   6. a smoke test of the site and the API
# Options: --no-pipelines (steps 1-3 only), --video-safe 0|1 (default 1), --org, --project, --github-connection.
# Tear down with scripts/teardown-env.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="" EMAIL="" FABRIC="" PIPELINES=1 VIDEO_SAFE=1
ORG="https://dev.azure.com/modality0876" PROJECT="FootballHackathon"
REPO="durjanh/regista" GH_CONNECTION="github.com_durjanh" CONNECTION="regista-azure"
SUBSCRIPTION="c79c28af-1f06-4846-9d89-0a2786eb6dc3"   # FootballHackathon
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --fabric) FABRIC=1; shift ;;
    --no-pipelines) PIPELINES=""; shift ;;
    --video-safe) VIDEO_SAFE="$2"; shift 2 ;;
    --org) ORG="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --github-connection) GH_CONNECTION="$2"; shift 2 ;;
    --subscription) SUBSCRIPTION="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$EMAIL" ]] || { echo "--email is required (certificate, API Management and budget notices)" >&2; exit 2; }
case "$PROFILE" in
  containerapps)  DIR="."                     ENV="regista" RG="rg-regista"        LOC="uksouth" ;;
  aks)            DIR="deploy/aks"            ENV="regaks"  RG="rg-regista-aks"    LOC="uksouth" ;;
  # Sweden Central: API Management Standard v2 is paused in UK South, and UK West lacks Dev Center (README, step 3c).
  aks-enterprise) DIR="deploy/aks-enterprise" ENV="regse"   RG="rg-regista-ent-se" LOC="swedencentral" ;;
  *) echo "--profile: containerapps | aks | aks-enterprise" >&2; exit 2 ;;
esac
step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
ado() { az "$@" --org "$ORG" --project "$PROJECT" --detect false; }

step "Azure subscription"
az account set --subscription "$SUBSCRIPTION"
az account show --query "{subscription:name, user:user.name}" -o tsv

step "azd environment '$ENV' ($PROFILE, $LOC)"
if ! azd -C "$DIR" env list --output json 2>/dev/null | grep -q "\"Name\": \"$ENV\""; then
  azd -C "$DIR" env new "$ENV" --location "$LOC" --subscription "$SUBSCRIPTION" --no-prompt
fi
azd -C "$DIR" env select "$ENV"
setenv() { azd -C "$DIR" env set "$1" "$2" >/dev/null && echo "  $1=$2"; }
# Location and subscription every time, not only on `env new`: without them `azd env refresh` (step 5) can't run.
setenv AZURE_LOCATION "$LOC"; setenv AZURE_SUBSCRIPTION_ID "$SUBSCRIPTION"
setenv AZURE_RESOURCE_GROUP "$RG"
setenv DEPLOYMENT_PROFILE "$PROFILE"
# gpt-5-mini: the model this subscription has quota for (the template defaults have none). 150 units per environment.
setenv CHAT_MODEL_NAME gpt-5-mini; setenv CHAT_MODEL_VERSION 2025-08-07
setenv REASONING_MODEL_NAME gpt-5-mini; setenv REASONING_MODEL_VERSION 2025-08-07
setenv API_SERVICE_SETTINGS "REGISTA_VIDEO_SAFE=$VIDEO_SAFE"
setenv BUDGET_EMAIL "$EMAIL"
setup_args=()
case "$PROFILE" in
  containerapps)
    setenv API_MIN_REPLICAS 1 ;;   # one warm API instance: no cold start for visitors
  aks)
    setenv LETSENCRYPT_EMAIL "$EMAIL"; setup_args+=(--letsencrypt-email "$EMAIL") ;;
  aks-enterprise)
    setenv APIM_PUBLISHER_EMAIL "$EMAIL"; setup_args+=(--apim-email "$EMAIL")
    setenv AZURE_DEVOPS_ORG_URL "$ORG"
    setenv DEVOPS_INFRASTRUCTURE_PRINCIPAL_ID "$(az ad sp list --display-name DevOpsInfrastructure --query '[0].id' -o tsv)" ;;
esac
setenv FABRIC_WORKSPACE_NAME PremierLeague

step "Azure DevOps: resource group, pipeline identity roles, variable group, environment"
scripts/setup-azure-devops.sh --org "$ORG" --project "$PROJECT" --profile "$PROFILE" --rg "$RG" --location "$LOC" \
  --env "$ENV" --budget-email "$EMAIL" ${setup_args[@]+"${setup_args[@]}"} \
  --repo-type github --repo "$REPO" --github-connection "$GH_CONNECTION"

# Enterprise: the Managed DevOps Pool is created by the pipeline's identity, which must be an organisation member with
# agent pool rights (Microsoft Learn: Managed DevOps Pools prerequisites, "creating a pool from a pipeline").
if [[ "$PROFILE" == "aks-enterprise" ]]; then
  step "Azure DevOps permissions for the pipeline identity (agent pool)"
  TOKEN=$(az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv)
  devops() {   # devops <method> <url> [json body]
    curl -sS -X "$1" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" ${3:+--data "$3"} "$2"
  }
  ORG_NAME="${ORG##*/}"
  PROJECT_ID=$(ado devops project show --project "$PROJECT" --query id -o tsv)
  APP_ID=$(ado devops service-endpoint list --query "[?name=='$CONNECTION'].authorization.parameters.serviceprincipalid | [0]" -o tsv)
  SP_OBJECT=$(az ad sp show --id "$APP_ID" --query id -o tsv)
  SP_NAME=$(az ad sp show --id "$APP_ID" --query displayName -o tsv)
  # Organisation member (Basic) and project contributor. Re-adding an existing member is harmless.
  devops POST "https://vsaex.dev.azure.com/$ORG_NAME/_apis/serviceprincipalentitlements?api-version=7.1-preview.1" \
    "{\"accessLevel\":{\"accountLicenseType\":\"express\"},\"projectEntitlements\":[{\"group\":{\"groupType\":\"projectContributor\"},\"projectRef\":{\"id\":\"$PROJECT_ID\"}}],\"servicePrincipal\":{\"origin\":\"aad\",\"originId\":\"$SP_OBJECT\",\"subjectKind\":\"servicePrincipal\"}}" >/dev/null
  IDENTITY=$(devops GET "https://vssps.dev.azure.com/$ORG_NAME/_apis/identities?searchFilter=General&filterValue=$SP_NAME&api-version=7.1" \
    | python3 -c "import sys,json; v=json.load(sys.stdin).get('value',[]); print(v[0]['id'] if v else '')")
  [[ -n "$IDENTITY" ]] || { echo "  ✖ $SP_NAME is not visible in $ORG yet: add it in Organization settings > Users, then re-run." >&2; exit 1; }
  echo "  $SP_NAME is an organisation member (identity $IDENTITY)"
  grant_pool_role() {   # grant_pool_role <scope> <resource id> <label>
    devops PUT "https://dev.azure.com/$ORG_NAME/_apis/securityroles/scopes/$1/roleassignments/resources/$2?api-version=7.1-preview.1" \
      "[{\"roleName\":\"Administrator\",\"userId\":\"$IDENTITY\"}]" >/dev/null && echo "  Administrator: $3"
  }
  grant_pool_role distributedtask.agentqueuerole "$PROJECT_ID" "project agent pools ($PROJECT)"   # create the pool
  # Updating an existing pool (every later provision) needs Administrator on the pool itself: granted once it exists.
  grant_existing_pool() {
    POOL_ID=$(devops GET "https://dev.azure.com/$ORG_NAME/_apis/distributedtask/pools?poolName=regista-mdp&api-version=7.1" \
      | python3 -c "import sys,json; v=json.load(sys.stdin).get('value',[]); print(v[0]['id'] if v else '')")
    if [[ -n "$POOL_ID" ]]; then grant_pool_role distributedtask.agentpoolrole "$POOL_ID" "agent pool regista-mdp"
    else echo "  agent pool regista-mdp doesn't exist yet (the Infrastructure run creates it)"; fi
  }
  grant_existing_pool
fi

run_pipeline() {   # run_pipeline <name> <key=value parameters...>; waits for the result
  local name="$1"; shift
  local id; id=$(ado pipelines run --name "$name" --folder-path '\Regista' --parameters "$@" --query id -o tsv)
  echo "  queued '$name' (run $id): $ORG/$PROJECT/_build/results?buildId=$id"
  echo "  approve the what-if there when the run waits on the regista-$PROFILE environment"
  local status="" result="" now="" last=""
  for _ in $(seq 1 240); do   # up to 2 hours
    read -r status result < <(ado pipelines runs show --id "$id" --query "[status, result]" -o tsv | tr '\t' ' ')
    [[ "$status" == "completed" ]] && break
    # Say what the run is doing whenever that changes: the running stage, or an approval it waits for.
    now=$(az devops invoke --org "$ORG" --detect false --area build --resource timeline \
      --route-parameters project="$PROJECT" buildId="$id" --api-version 7.1 -o json 2>/dev/null | python3 -c '
import sys, json
recs = json.load(sys.stdin).get("records") or []
if any(r["type"] == "Checkpoint.Approval" and r["state"] == "inProgress" for r in recs):
    print("waiting for your approval (open the run above: Review > Approve)")
else:
    running = [r["name"] for r in recs if r["type"] == "Stage" and r["state"] == "inProgress"]
    print("running: " + ", ".join(running) if running else "queued, waiting for an agent")
' 2>/dev/null || true)
    [[ -n "$now" && "$now" != "$last" ]] && echo "  $(date +%H:%M) $now"
    last="$now"
    sleep 30
  done
  echo "  '$name': ${status:-unknown} ${result:-}"
  [[ "$result" == "succeeded" ]] || { echo "  ✖ '$name' didn't succeed: open the run above for the failing step." >&2; exit 1; }
}

if [[ -n "$PIPELINES" ]]; then
  if [[ "$PROFILE" == "aks-enterprise" ]]; then
    # Azure DevOps checks every pool a pipeline uses before its first stage, so the pool must exist before
    # Full environment is queued: Infrastructure (Microsoft-hosted agent) creates it.
    step "Pipeline: Infrastructure ($PROFILE)"
    run_pipeline "Infrastructure" "profile=$PROFILE"
    grant_existing_pool
  fi
  step "Pipeline: Full environment ($PROFILE)"
  run_pipeline "Full environment" "profile=$PROFILE"
fi

azd -C "$DIR" env refresh -e "$ENV" >/dev/null 2>&1 || true   # the pipeline's outputs into this machine's environment
if [[ -n "$FABRIC" ]]; then
  step "Microsoft Fabric (from this machine: the pipelines have no Fabric access)"
  azd -C "$DIR" hooks run postprovision -e "$ENV"
fi

step "Smoke test"
WEB_URL=$(azd -C "$DIR" env get-value WEB_URL -e "$ENV" 2>/dev/null || true)
API_URL=$(azd -C "$DIR" env get-value API_URL -e "$ENV" 2>/dev/null || true)
echo "  site: ${WEB_URL:-unknown}"
echo "  API:  ${API_URL:-unknown}"
if [[ -n "$API_URL" ]]; then
  code=000
  for _ in $(seq 1 10); do   # a scaled-to-zero or just-deployed API can take a moment
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$API_URL/api/health" || true)
    [[ "$code" == "200" ]] && break
    sleep 15
  done
  [[ "$code" == "200" ]] && echo "  ✔ API healthy" || echo "  ⚠ API health returned $code: check the API pods/app and the deploy log"
fi
