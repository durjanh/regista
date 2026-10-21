#!/usr/bin/env sh
# azd postdeploy hook for every profile: find the public URL, store it in the azd environment (REGISTA_PUBLIC_URL,
# which the next provision passes to the recap Function so nothing drifts), point the Function at it, smoke-test.
set -eu

profile="${DEPLOYMENT_PROFILE:-containerapps}"
url="${REGISTA_PUBLIC_URL:-}"

case "$profile" in
  containerapps)
    url="${WEB_URL:-$url}"
    ;;
  aks)
    az aks get-credentials -g "$AZURE_RESOURCE_GROUP" -n "$AZURE_AKS_CLUSTER_NAME" --overwrite-existing -o none
    kubelogin convert-kubeconfig -l azurecli
    for _ in $(seq 1 30); do
      ip=$(kubectl -n regista get ingress regista-web -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
      [ -n "$ip" ] && break
      sleep 10
    done
    [ -n "${ip:-}" ] && url="http://$ip"
    ;;
  aks-enterprise)
    : # Front Door's endpoint is known at provision time (REGISTA_PUBLIC_URL output).
    ;;
esac

if [ -z "$url" ]; then
  echo "⚠ No public URL yet; skipping the smoke test."
  exit 0
fi

azd env set REGISTA_PUBLIC_URL "$url"
if [ -n "${FUNCTION_APP_NAME:-}" ] && [ "$profile" = "aks" ]; then
  az functionapp config appsettings set -g "$AZURE_RESOURCE_GROUP" -n "$FUNCTION_APP_NAME" \
    --settings "REGISTA_API_URL=$url" -o none
fi

echo "▶ Smoke test $url/api/health"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 "$url/api/health" >/dev/null 2>&1; then
    echo "✔ Regista is live: $url"
    exit 0
  fi
  sleep 10
done
echo "✖ $url/api/health did not answer within 5 minutes" >&2
exit 1
