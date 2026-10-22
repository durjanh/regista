#!/usr/bin/env sh
# azd preprovision hook (Container Apps). SERVICE_API_IMAGE_NAME keeps the running image across re-provisions, but
# after `azd down` it names an image in a registry that no longer exists (or was recreated empty), and provisioning
# would point the API at it. Forget it when the image isn't in the registry; the first rollout restores it.
set -eu

image="${SERVICE_API_IMAGE_NAME:-}"
[ -n "$image" ] || exit 0
registry="${image%%.*}"                 # crregistaxxxx.azurecr.io/regista/api-regista:tag -> crregistaxxxx
repo_tag="${image#*/}"                  # regista/api-regista:tag
if az acr repository show --name "$registry" --image "$repo_tag" -o none >/dev/null 2>&1; then
  exit 0
fi
echo "ℹ $image is no longer in the registry (after azd down?); provisioning with the placeholder image"
azd env unset SERVICE_API_IMAGE_NAME
