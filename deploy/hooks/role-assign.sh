#!/usr/bin/env sh
# Idempotent role assignment for hooks and scripts: create only if this principal doesn't already hold the role at
# this scope, so re-running never fails (az versions differ on whether a duplicate create errors).
#   sh deploy/hooks/role-assign.sh <principal-object-id> <User|ServicePrincipal|Group> "<role name or id>" <scope>
set -eu
principal="$1"; type="$2"; role="$3"; scope="$4"
existing=$(az role assignment list --assignee "$principal" --role "$role" --scope "$scope" --query "length(@)" -o tsv 2>/dev/null || echo 0)
if [ "${existing:-0}" = "0" ]; then
  az role assignment create --assignee-object-id "$principal" --assignee-principal-type "$type" --role "$role" --scope "$scope" -o none
  echo "  granted '$role'"
else
  echo "  already has '$role'"
fi
