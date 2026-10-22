#!/usr/bin/env bash
# Full what-if for a profile: every resource and sub-resource Azure would create, modify or delete.
# `azd provision --preview` prints only the resource types azd has display names for (it omits, for example,
# Web PubSub, the managed identity, consumer groups and Cosmos containers); this lists them all. Creates nothing.
# Then a dry run of the Fabric setup (Fabric items aren't Azure resources, so no Azure preview can show them).
#   scripts/preview-all.sh                            # Container Apps (root azd project)
#   scripts/preview-all.sh --profile aks              # deploy/aks azd project
#   scripts/preview-all.sh --profile aks-enterprise   # deploy/aks-enterprise azd project
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="containerapps" CHECK=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;   # idempotency: exit 1 on real drift (scripts/check-idempotency.sh)
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$PROFILE" in
  containerapps) project="." template=infra/main.bicep params=infra/main.bicepparam ;;
  aks|aks-enterprise) project="deploy/$PROFILE" template="infra/$PROFILE/main.bicep" params="infra/$PROFILE/main.parameters.json" ;;
  *) echo "--profile: containerapps | aks | aks-enterprise" >&2; exit 2 ;;
esac

# The azd environment of that project supplies every value, exactly as `azd provision` would. Check one exists first:
# `azd env get-values` without one would create an empty environment.
has_env=$(azd -C "$project" env list --output json 2>/dev/null | python3 -c 'import sys, json; print(any(e.get("IsDefault") for e in json.load(sys.stdin)))')
[ "$has_env" = "True" ] && values=$(azd -C "$project" env get-values 2>/dev/null) || {
  echo "No azd environment in $project yet. Create one first (README, step 3):" >&2
  echo "  cd $project && azd env new <name> --location uksouth && azd env set AZURE_RESOURCE_GROUP <rg>" >&2
  exit 1
}
set -a; eval "$values"; set +a
: "${AZURE_RESOURCE_GROUP:?azd env set AZURE_RESOURCE_GROUP <rg> in $project}"
: "${AZURE_PRINCIPAL_ID:=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)}"
export AZURE_PRINCIPAL_ID
if [ "$(az group exists -n "$AZURE_RESOURCE_GROUP")" != "true" ]; then
  echo "Resource group $AZURE_RESOURCE_GROUP doesn't exist yet. What-if needs it (an empty group is free):" >&2
  echo "  az group create -n $AZURE_RESOURCE_GROUP -l ${AZURE_LOCATION:-uksouth}" >&2
  exit 1
fi

if [ "$PROFILE" != "containerapps" ]; then
  # azd substitutes ${VAR} and ${VAR=default} in main.parameters.json; do the same for az.
  resolved=$(mktemp "${TMPDIR:-/tmp}/regista-params.XXXXXX")
  trap 'rm -f "$resolved"' EXIT
  python3 - "$params" > "$resolved" <<'EOF'
import os, re, sys
text = open(sys.argv[1]).read()
print(re.sub(r"\$\{([A-Z0-9_]+)(?:=([^}]*))?\}", lambda m: os.environ.get(m[1]) or (m[2] or ""), text))
EOF
  params="@$resolved"
fi

echo "▶ Azure what-if ($PROFILE): $AZURE_RESOURCE_GROUP"
az deployment group what-if -g "$AZURE_RESOURCE_GROUP" --template-file "$template" --parameters "$params" \
  --no-pretty-print -o json | CHECK="$CHECK" python3 -c '
import os, sys, json, collections
d = json.load(sys.stdin)
rows = collections.Counter()
drift = []
def leaves(delta, pre=""):
    for x in delta or []:
        key = x["path"]
        p = f"{pre}.{key}" if pre else key
        yield from (leaves(x["children"], p) if x.get("children") else [(p, x)])
for c in d["changes"]:
    ct = c["changeType"]
    if "oleAssignments" in c["resourceId"]:  # ARM roleAssignments and Cosmos sqlRoleAssignments
        t = "role assignments (ARM + Cosmos data plane)"
    else:
        p = c["resourceId"].split("/providers/")[-1].split("/")
        t = p[0] + "/" + "/".join(p[1::2][: (len(p) - 1) // 2])
    rows[(ct, t)] += 1
    if ct in ("Create", "Delete"):
        drift.append(f"{ct} {t}")
    # What-if noise, not drift: "Delete" = a server-side default the template does not set (incremental mode keeps
    # it); an "after" that is still an expression ("[reference(...)]") resolves at deploy time to the same value;
    # "Create" from null = a write-only or defaulted property the service does not echo back.
    for path, x in leaves(c.get("delta")) if ct == "Modify" else []:
        after = x.get("after")
        if x["propertyChangeType"] == "Modify" and not (isinstance(after, str) and after.startswith("[")):
            before = json.dumps(x.get("before"))
            drift.append(f"Modify {t}: {path} {before} -> {json.dumps(after)}")
for (ct, t), n in sorted(rows.items(), key=lambda x: x[0][1]):
    print(f"  {ct:<11} {n:>3} x {t}")
status = d["status"]
print(f"  status {status}, {sum(rows.values())} changes (Unsupported = role assignments named from the new identity, resolved at deploy time)")
if os.environ.get("CHECK"):
    if drift:
        print("✖ Not idempotent: a re-run would change", *drift, sep="\n  ", file=sys.stderr)
        sys.exit(1)
    print("✔ Idempotent: a re-run changes nothing (Modify rows above are what-if noise: server defaults, deploy-time expressions)")'

if [ -n "${FABRIC_WORKSPACE_NAME:-}" ] && [ -z "$CHECK" ]; then
  echo
  echo "▶ Microsoft Fabric dry run: workspace '$FABRIC_WORKSPACE_NAME' (nothing is created)"
  py=backend/api/.venv/bin/python; [ -x "$py" ] || py=python3
  set -- --workspace "$FABRIC_WORKSPACE_NAME" --dry-run
  [ -n "${FABRIC_CAPACITY_NAME:-}" ] && set -- "$@" --capacity-name "$FABRIC_CAPACITY_NAME"
  [ -n "${FABRIC_EVENTHUB_CONNECTION_ID:-}" ] && set -- "$@" --eventhub-connection-id "$FABRIC_EVENTHUB_CONNECTION_ID"
  [ "$PROFILE" = "aks-enterprise" ] && set -- "$@" --eventhub-private
  "$py" scripts/fabric-setup.py "$@"
fi
