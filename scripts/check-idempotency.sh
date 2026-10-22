#!/usr/bin/env bash
# Proves the infrastructure is idempotent: right after a successful `azd provision`, a what-if of the same template
# must show no real change. `azd provision --preview` can't be used for this: it lists every resource with what-if
# noise (server-side defaults, values only known at deploy time) as "Modify". Run it from an azd project directory:
# the repo root (Container Apps), deploy/aks or deploy/aks-enterprise.
#   scripts/check-idempotency.sh      (or ../../scripts/check-idempotency.sh from deploy/<profile>)
set -euo pipefail

here=$(pwd)
root=$(cd "$(dirname "$0")/.." && pwd)
case "$here" in
  "$root") profile=containerapps ;;
  "$root/deploy/aks") profile=aks ;;
  "$root/deploy/aks-enterprise") profile=aks-enterprise ;;
  *) echo "Run from the repo root, deploy/aks or deploy/aks-enterprise" >&2; exit 2 ;;
esac
exec "$root/scripts/preview-all.sh" --profile "$profile" --check
