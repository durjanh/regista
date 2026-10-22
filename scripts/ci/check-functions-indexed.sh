#!/usr/bin/env bash
# After a Functions deploy: fail unless the host registered the expected functions. A zip deploy succeeds even when
# the Python worker can't index function_app.py (an import error, an unsupported annotation): the app then runs with
# 0 functions and nothing says so. The host indexes a few seconds to a minute after the deploy, so this waits.
#   scripts/ci/check-functions-indexed.sh <resource-group> <function-app> [expected-function ...]
set -euo pipefail
rg="$1" app="$2"; shift 2
expected=("${@:-on_match_events}")

for attempt in $(seq 1 18); do   # up to ~3 minutes
  # Names come back as "<app>/<function>".
  found=$(az functionapp function list -g "$rg" -n "$app" --query "[].name" -o tsv 2>/dev/null | sed 's#.*/##' || true)
  missing=()
  for f in "${expected[@]}"; do grep -qx "$f" <<<"$found" || missing+=("$f"); done
  if [ ${#missing[@]} -eq 0 ]; then
    echo "Functions registered on $app:" $found
    exit 0
  fi
  sleep 10
done

echo "Not registered on $app after 3 minutes: ${missing[*]} (registered: ${found:-none})" >&2
echo "The worker most likely failed to index function_app.py. Find the reason in Application Insights:" >&2
echo "  exceptions | where cloud_RoleName has '$app' | where outerMessage has 'FunctionLoadError' | take 5" >&2
exit 1
