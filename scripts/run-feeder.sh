#!/usr/bin/env bash
# Start one run of the feeder job (Container Apps): publishes a match's events to Event Hubs, which feed the Fabric
# Eventstream and the recap Function (and the API when LIVE_SOURCE=eventhub).
#   scripts/run-feeder.sh --rg rg-regista [--job regista-feeder] [--match-id <id>] [--speed 30] [--start-t 0]
# Uses the Container Apps REST API: `az containerapp job start --args` treats values that start with "-" (--speed)
# as its own options, so the arguments can't be passed that way.
set -euo pipefail

RG="" JOB="regista-feeder" MATCH="2026-07-15-england-argentina" SPEED="30" START_T="0"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rg) RG="$2"; shift 2 ;;
    --job) JOB="$2"; shift 2 ;;
    --match-id) MATCH="$2"; shift 2 ;;
    --speed) SPEED="$2"; shift 2 ;;
    --start-t) START_T="$2"; shift 2 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
: "${RG:?--rg <resource group> is required}"

job=$(az containerapp job show -g "$RG" -n "$JOB" -o json)
body=$(JOB_JSON="$job" MATCH="$MATCH" SPEED="$SPEED" START_T="$START_T" python3 - <<'EOF'
import json, os
c = json.loads(os.environ["JOB_JSON"])["properties"]["template"]["containers"][0]
print(json.dumps({"containers": [{
    "name": c["name"], "image": c["image"], "env": c.get("env", []), "resources": c["resources"],
    "command": ["python", "-m", "app.live.feeder"],
    "args": ["--match-id", os.environ["MATCH"], "--speed", os.environ["SPEED"], "--start-t", os.environ["START_T"]],
}]}))
EOF
)
id=$(jq -r .id <<<"$job" 2>/dev/null || python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$job")
execution=$(az rest --method post --url "https://management.azure.com${id}/start?api-version=2024-03-01" --body "$body" --query name -o tsv)
echo "Started $execution: $MATCH at ${SPEED}x from t=${START_T}s"
echo "Watch it:  az containerapp job execution show -g $RG -n $JOB --job-execution-name $execution --query properties.status -o tsv"
