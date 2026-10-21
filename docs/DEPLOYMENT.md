# Deploying Regista

This guide takes you from an empty subscription to a running deployment in one of three profiles (Container Apps, AKS, or private AKS behind API Management) with azd, GitHub Actions or Azure Pipelines, plus Functions and Microsoft Fabric. Every step is repeatable, and re-running a step changes nothing that's already correct.

## Deployment profiles

The app and the platform (Foundry, Event Hubs, Cosmos DB, Storage, Functions, Fabric, monitoring) are the same in every profile; only the compute and the network change. Each profile is an azd project. Diagrams: [Container Apps](architecture.drawio) · [AKS standard](architecture-aks.drawio) · [AKS enterprise](architecture-aks-enterprise.drawio).

| Profile | azd project | Infrastructure | What it adds | Rough monthly cost* |
|---|---|---|---|---|
| **containerapps** (default, live judge demo) | `azure.yaml` (repo root) | `infra/main.bicep` | Container Apps (API, web, feeder job) | ~$110–200 |
| **aks** | `deploy/aks/azure.yaml` | `infra/aks/main.bicep` | AKS (Entra RBAC, workload identity, CNI overlay + Cilium, app routing NGINX, Container Insights), Kubernetes manifests in `deploy/k8s` | ~$250–400 |
| **aks-enterprise** | `deploy/aks-enterprise/azure.yaml` | `infra/aks-enterprise/main.bicep` | VNet + NSGs, private endpoints and private DNS for ACR (Premium), Storage, Cosmos DB, Event Hubs and Foundry; private AKS (Standard tier, Azure Policy); internal NGINX on 10.40.4.10; API Management Standard v2 as the only public endpoint (VNet integration out to the ingress); VNet-integrated Functions; Managed DevOps Pool | ~$1,000–1,400 |

\*Estimates only, from list prices at the time of writing, before model tokens and Fabric. Check the [pricing calculator](https://azure.microsoft.com/pricing/calculator/) for your region. The biggest enterprise items are API Management Standard v2 and the AKS nodes; tear the enterprise profile down when you are not using it.

**Prerequisites for azd**: [azd](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd), Azure CLI, Docker, and for AKS `kubectl` + `kubelogin` (`az aks install-cli`), because local cluster accounts are disabled. Sign in to the subscription you mean to use (a personal one for the hackathon): `az account show`.

### Container Apps (azd)

```bash
azd auth login
azd env new regista && azd env set AZURE_RESOURCE_GROUP rg-regista
azd provision --preview     # what-if
azd up
```

`scripts/deploy.sh` and the GitHub Actions workflows below remain as an alternative path for the same template.

### AKS standard (azd)

```bash
cd deploy/aks
azd env new regaks && azd env set AZURE_RESOURCE_GROUP rg-regista-aks
azd env set AKS_AUTHORIZED_IP_RANGES "$(curl -s https://api.ipify.org)/32"   # optional: lock the API server to you
azd provision --preview && azd up
```

The postprovision hook grants you *Azure Kubernetes Service RBAC Cluster Admin* and AcrPush (by role name; `az role assignment create` is idempotent). The postdeploy hook waits for the ingress IP, stores it as `REGISTA_PUBLIC_URL` (so the next provision gives it to the recap Function without drift) and smoke-tests `/api/health`. The ingress is plain HTTP on the load balancer IP; add a domain and TLS (app routing with a Key Vault certificate) before real users.

### AKS enterprise (azd, deploy from inside the VNet)

```bash
cd deploy/aks-enterprise
azd env new regent && azd env set AZURE_RESOURCE_GROUP rg-regista-ent
azd env set APIM_PUBLISHER_EMAIL you@example.com
azd env set AZURE_DEVOPS_ORG_URL https://dev.azure.com/<org>                       # for the Managed DevOps Pool
azd env set DEVOPS_INFRASTRUCTURE_PRINCIPAL_ID "$(az ad sp list --display-name DevOpsInfrastructure --query '[0].id' -o tsv)"
azd provision --preview
azd provision      # one pass; the public URL is the API Management gateway (REGISTA_PUBLIC_URL)
```

Then deploy from the Azure DevOps pipeline (below): its Deploy stage runs on the Managed DevOps Pool inside `snet-agents`, the only place that can reach the private API server and the private registry. API Management is the only public endpoint: its gateway (HTTPS on `*.azure-api.net`, rate-limited per client IP) reaches the internal NGINX ingress on 10.40.4.10 through VNet integration. There is no WAF in this profile; for production, put Front Door Premium or Application Gateway WAF in front of the gateway. The Front Door design, with its pitfalls, is in [ARCHITECTURE.md: Future: Azure Front Door](ARCHITECTURE.md#future-azure-front-door-in-front-of-api-management). For development only, `azd env set AKS_PRIVATE_CLUSTER false` plus `AKS_AUTHORIZED_IP_RANGES` makes the API server public but IP-restricted; the registry and data services stay private, so `azd deploy` from a laptop still needs the in-VNet agent.

Known limits: the AKS application routing add-on's NGINX is supported by Microsoft through November 2026 (Gateway API is the migration path); Fabric Eventstream needs a Fabric managed private endpoint (F SKU) to read the private Event Hubs namespace.

### Azure DevOps pipelines

| Pipeline | File | What it does |
|---|---|---|
| CI | `.azuredevops/pipelines/ci.yml` | Ruff, pytest with the 90% coverage floor, the offline evaluation gate, Vitest with its coverage floor, web build, Bicep build + lint for all three profiles, manifest and hook checks. Mirrors `.github/workflows/ci.yml` |
| Deploy | `.azuredevops/pipelines/azure-dev.yml` | Parameter `profile`. Preview (`azd provision --preview`) → Provision → Deploy, the last two as deployment jobs on the environment `regista-<profile>` so an approval check gates them. Enterprise Deploy runs on the Managed DevOps Pool |

One-time setup (service connection with workload identity federation and no secret, the variable group `regista-<profile>`, both pipelines):

```bash
export AZURE_DEVOPS_EXT_PAT=<PAT>
scripts/setup-azure-devops.sh --org https://dev.azure.com/<org> --project <project> --profile aks-enterprise \
  --rg rg-regista-ent --location uksouth --env regent --apim-email you@example.com \
  --repo-type github --repo <owner>/<repo> --github-connection <github-service-connection>
```

Then add an approval check on the `regista-<profile>` environment and run *regista-azure-dev*. For the enterprise profile, pass the pool name (the `AZURE_DEVOPS_POOL_NAME` output) as `managedPool`.

## 0. Prerequisites

- An Azure subscription where you can create resource groups and role assignments (Owner, or Contributor + User Access Administrator).
- Model quota in **UK South** for `gpt-5.4-mini` and `gpt-5.5`, Global Standard. Check under Foundry portal → Quotas, or run `az cognitiveservices usage list -l uksouth`.
- Tools: `az` (2.60+), `gh` (logged in), `jq`, Python 3.12, Node.js 22.
- The repo pushed to GitHub. The hackathon rules require a **public** repository.
- For Fabric: a Fabric trial (free, 60 days) or a paid capacity, and permission to create workspaces in your Fabric tenant.

## 1. Bootstrap GitHub ↔ Azure (OIDC, no secrets)

```bash
az login
gh auth login
scripts/bootstrap-github-oidc.sh --rg rg-regista --location uksouth --env regista
```

This script does the following:
1. Creates the resource group.
2. Creates an Entra app and service principal, with federated credentials for `main`, pull requests and the `production` environment.
3. Grants Contributor and Role Based Access Control Administrator on the resource group only.
4. Sets these repo secrets with the GitHub CLI: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. None of these is a credential.
5. Sets these repo variables: `AZURE_RESOURCE_GROUP`, `AZURE_LOCATION`, `AZURE_ENV_NAME`.
6. Creates the `production` environment.

Optional: add required reviewers to the `production` environment (repo Settings → Environments) so deployments wait for approval.

## 2. Provision infrastructure

```bash
gh workflow run infra.yml
gh run watch
```

The **What-if** job posts a change table to the run summary. The **Deploy** job then applies `infra/main.bicep`.

The first run deploys the Container Apps with a public placeholder image, because the registry is still empty. Re-running the workflow later never reverts a real image: it reads the currently deployed images and passes them back in.

To deploy from your laptop instead:

```bash
az deployment group what-if -g rg-regista -n main -f infra/main.bicep -p infra/main.bicepparam
az deployment group create  -g rg-regista -n main -f infra/main.bicep -p infra/main.bicepparam
```

Main parameters (`infra/main.bicepparam`):

| Parameter | Default | Notes |
|---|---|---|
| `environmentName` | `regista` | Prefix for every name |
| `location` | `uksouth` | |
| `chatModel` / `reasoningModel` | gpt-5.4-mini `2026-03-17` / gpt-5.5 `2026-04-24` | Swap if quota is short (see Troubleshooting) |
| `chatCapacity` / `reasoningCapacity` | 100 / 50 (K TPM) | |
| `liveSource` | `replay` | `eventhub` makes the API consume the feeder's Event Hubs stream |
| `deployFunctions` | `true` | Recap automation |
| `deployFabricCapacity` | `false` | `true` creates a billed F2. Prefer the trial. |
| `oneLakeWorkspace` / `oneLakeLakehouse` | empty | Set after step 5 |

## 3. Build and deploy the apps

```bash
gh workflow run deploy.yml
gh run watch
```

1. **ACR Tasks** builds `regista-api` from the repo root (the image bundles `data/`) and `regista-web` from `apps/web`. No Docker daemon or registry password is needed on the runner.
2. **First rollout:** the workflow detects the placeholder image and runs the full Bicep template with the new images. That switches the ports, health probes and the feeder command to the real configuration.
3. **Later rollouts:** the workflow uses `az containerapp update --image`, which creates new revisions.
4. The Function App is deployed with `Azure/functions-action` (Flex Consumption remote build).
5. A smoke test checks `/api/health`, the web `/healthz`, and the web → API proxy.

The run summary lists the URLs. You can also read them from the deployment outputs:

```bash
az deployment group show -g rg-regista -n main --query "properties.outputs.{web:WEB_URL.value, api:API_URL.value, mcp:MCP_URL.value}"
```

## 4. Run a live match through Event Hubs

The API replays matches in-process by default. To exercise the full event-driven path (feeder → Event Hubs → API / Function / Fabric):

```bash
# Make the API consume Event Hubs (one-off; or set liveSource = 'eventhub' in main.bicepparam)
az containerapp update -g rg-regista -n regista-api --set-env-vars LIVE_SOURCE=eventhub

# Stream a match (default speed 1 = real time). Override the arguments for a faster demo:
az containerapp job start -g rg-regista -n regista-feeder
az containerapp job start -g rg-regista -n regista-feeder \
  --image "$(az containerapp job show -g rg-regista -n regista-feeder --query 'properties.template.containers[0].image' -o tsv)" \
  --command "python" "-m" "app.live.feeder" --args "--match-id" "<match_id>" "--speed" "30"

az containerapp job execution list -g rg-regista -n regista-feeder -o table
```

When the feeder publishes `full_time`, the Function generates the broadcaster recap and writes it to Cosmos DB `recaps` and to `recaps/<match_id>.json` in Blob Storage.

## 5. Microsoft Fabric (Lakehouse + Real-Time Intelligence)

1. **Capacity.** Start a Fabric trial (Fabric portal → Account manager → *Start trial*). Alternatively, set `deployFabricCapacity = true` and `FABRIC_ADMIN_EMAIL`, then re-run the infra workflow. Pause a paid capacity when you're not using it.

2. **Workspace, Lakehouse, Eventhouse and reference data:**

   ```bash
   pip install azure-identity
   python scripts/fabric-setup.py --workspace "Regista" \
     --capacity-name "<trial or F2 capacity name>" \
     --resource-group rg-regista \
     --identity-name "$(az deployment group show -g rg-regista -n main --query properties.outputs.IDENTITY_NAME.value -o tsv)"
   ```

   The script creates or reuses the following, and prints the `ONELAKE_*` values to use:
   - the workspace
   - Lakehouse `regista_lakehouse`, with the CC0 reference CSVs uploaded to `Files/reference/`
   - Eventhouse `regista_eventhouse`
   - KQL database `regista_live`, with table `match_events` and JSON mapping `match_events_json`
   - Contributor access to the workspace for the API's managed identity, so Data Forge can export to OneLake

3. **Point Data Forge at OneLake.** Set `oneLakeWorkspace = 'Regista'` and `oneLakeLakehouse = 'regista_lakehouse'` in `infra/main.bicepparam`, then re-run the infra workflow.

4. **Workspace identity for the Eventstream (keyless).** Our Event Hubs namespace has local (SAS) auth disabled, so the Eventstream uses the **workspace identity**:
   1. Fabric portal → workspace *Regista* → Workspace settings → **Workspace identity** → *+ Workspace identity*. Copy its **ID**.
   2. Grant it read access to the event hub:

      ```bash
      az role assignment create --assignee "<workspace identity ID>" \
        --role "Azure Event Hubs Data Receiver" \
        --scope "$(az eventhubs namespace list -g rg-regista --query '[0].id' -o tsv)"
      ```

5. **Eventstream** (portal):
   1. In the workspace, create a new **Eventstream** named `regista-live`.
   2. Choose *Connect data sources* → **Azure Event Hubs** → feature level **Extended features**.
   3. Enter the namespace `<evh-…>` (output `EVENTHUB_FQDN` without `.servicebus.windows.net`) and the event hub `match-events`.
   4. Set **Authentication kind** to **Workspace identity**, the **Consumer group** to `fabric`, and the data format to **JSON**.
   5. Add a destination: **Eventhouse** → *Event processing before ingestion* → database `regista_live`, table `match_events`, input format JSON.
   6. Select **Publish**.

6. **Query.** Open the KQL queryset on `regista_live` and paste the queries from `docs/kql/`:
   - `live-momentum.kql`: xT added per minute per team
   - `shots-by-team.kql`: shots, xG and finishing delta
   - `ingest-latency.kql`: p50/p95/p99 from feeder to Eventhouse (needs the feeder to stamp `emitted_at`)

7. **Real results next to the reconstructions.** In a Lakehouse notebook, or the SQL analytics endpoint after loading the CSVs as tables:

   ```sql
   -- Spark SQL in a Fabric notebook attached to regista_lakehouse
   CREATE OR REPLACE TEMP VIEW results USING csv
     OPTIONS (path 'Files/reference/results.csv', header 'true', inferSchema 'true');

   SELECT tournament, COUNT(*) AS matches,
          ROUND(AVG(home_score + away_score), 2) AS goals_per_match
   FROM results
   WHERE date >= '1990-01-01' AND tournament <> 'Friendly'
   GROUP BY tournament
   ORDER BY matches DESC
   LIMIT 15;
   ```

## 6. Local development against Azure

```bash
scripts/grant-dev-access.sh --rg rg-regista   # your user gets the same data-plane roles; prints env values
# paste the printed values into services/api/.env
scripts/local-dev.sh                           # API :8000, web :5173
```

With no `.env`, the API runs in offline mode, with deterministic, data-grounded narratives.

## 7. GitHub Copilot Agent Mode + MCP

Open the repo in VS Code. `.vscode/mcp.json` registers these servers:
- `regista-local` (`http://localhost:8000/mcp`)
- `regista-cloud` (prompts for the deployed API URL)
- the **Azure MCP Server** (`npx -y @azure/mcp@latest server start`)
- Microsoft Learn

In Copilot Chat (Agent mode), pick the custom agent **match-analyst** to analyse matches through the Regista tools, or **azure-operator** to inspect the deployment through Azure MCP.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `InsufficientQuota` / `DeploymentModelNotSupported` on the model deployments | Lower `chatCapacity` / `reasoningCapacity`, request quota, or switch models in `main.bicepparam`. `gpt-5.4-nano` (`2026-03-17`) and `gpt-5.4` (`2026-03-05`) are also Global Standard in uksouth. Or deploy to `swedencentral`. |
| `AuthorizationFailed` / 403 right after the first deployment | New role assignments take up to ~10 minutes to propagate. Restart the revision: `az containerapp revision restart`. |
| Container App stuck on the placeholder (`mcr.microsoft.com/k8se/quickstart`) | Run the Deploy workflow. The first rollout applies the full template with the real images. |
| `az acr build` fails with authorization errors | The pipeline principal needs Contributor on the resource group. Re-run the bootstrap script. |
| Function not triggering on `full_time` | Check `EventHubConnection__fullyQualifiedNamespace` in the app settings, the consumer group `functions`, and that the identity has Event Hubs Data Receiver. Logs: `az monitor app-insights query`. |
| Eventstream source can't connect | Use **Extended features** with **Workspace identity**, and make sure that identity has *Azure Event Hubs Data Receiver* on the namespace. SAS keys won't work because local auth is disabled. |
| Fabric API returns 401/403 | Your account must be allowed to create workspaces (tenant setting) and must be an admin of the capacity. Service principals also need *Service principals can call Fabric public APIs* enabled. |
| Cosmos DB 403 locally | Run `scripts/grant-dev-access.sh`. Cosmos data access uses its own RBAC, separate from Azure RBAC. |

## Teardown

```bash
az group delete -n rg-regista --yes --no-wait
# Fabric items live in Fabric, not the resource group. Delete the "Regista" workspace in the Fabric portal.
# Optional: remove the GitHub OIDC app registration created by the bootstrap script
az ad app delete --id "$(az ad app list --display-name 'gh-<owner>-<repo>-regista' --query '[0].appId' -o tsv)"
```

Keep the deployment running until **10 November 2026, 23:59 PT**. The rules require the project to stay available to judges until the judging period ends.
