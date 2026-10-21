#!/usr/bin/env bash
# Proves the infrastructure is idempotent: right after a successful `azd provision`, a preview (what-if) of the same
# template must show nothing to create, modify or delete. Run it from an azd project directory: the repo root
# (Container Apps), deploy/aks or deploy/aks-enterprise.
#   scripts/check-idempotency.sh      (or ../../scripts/check-idempotency.sh from deploy/<profile>)
set -euo pipefail

out=$(azd provision --preview --no-prompt 2>&1) || { echo "$out"; echo "✖ preview failed" >&2; exit 1; }
echo "$out"
changes=$(printf '%s\n' "$out" | grep -E '^[[:space:]]*(Create|Modify|Delete)[[:space:]]*:' || true)
if [ -n "$changes" ]; then
  echo "✖ Not idempotent: a re-run would still change:" >&2
  printf '%s\n' "$changes" >&2
  exit 1
fi
echo "✔ Idempotent: re-running the provision changes nothing."
