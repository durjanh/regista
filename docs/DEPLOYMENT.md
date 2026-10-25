# Deploying Regista

This guide takes you from an empty subscription to a running deployment in one of three profiles (Container Apps, AKS, or private AKS behind API Management) with azd, GitHub Actions or Azure Pipelines, plus Functions and Microsoft Fabric. Every step is repeatable, and re-running a step changes nothing that's already correct.

## Deployment profiles

The app and the platform (Foundry, Event Hubs, Cosmos DB, Storage, Functions, Fabric, monitoring) are the same in every profile; only the compute and the network change. Each profile is an azd project. Diagrams: [Container Apps](architecture.drawio) · [AKS standard](architecture-aks.drawio) · [AKS enterprise](architecture-aks-enterprise.drawio).

| Profile | azd project | Infrastructure | What it adds | Rough monthly cost* |
|---|---|---|---|---|
| **containerapps** (default, live judge demo) | `azure.yaml` (repo root) | `infra/main.bicep` | Container Apps (API scales to zero, feeder job); React SPA on Static Web Apps (Free); serverless Cosmos DB, Flex Consumption Functions; Web PubSub Standard (1 unit) for the live broadcast | ~$80 idle; ~$90–150 with demo traffic |
| **aks** | `deploy/aks/azure.yaml` | `infra/aks/main.bicep` | AKS (Entra RBAC, workload identity, CNI overlay + Cilium, Container Insights); the API on app-routing NGINX with a static IP, DNS label and Let's Encrypt HTTPS; SPA on Static Web Apps (Free); manifests in `deploy/k8s/aks`; Web PubSub | ~$300–450 |
| **aks-enterprise** | `deploy/aks-enterprise/azure.yaml` | `infra/aks-enterprise/main.bicep` | VNet + NSGs, private endpoints and private DNS for ACR (Premium), Storage, Cosmos DB, Event Hubs, Foundry and Web PubSub (public side: client connections only); private AKS (Standard tier, Azure Policy); internal NGINX on 10.40.4.10; API Management Standard v2 as the only public API endpoint (VNet integration out to the ingress); SPA on Static Web Apps (Free); VNet-integrated Functions; Managed DevOps Pool | ~$1,050–1,450 |

**Front end in every profile: Azure Static Web Apps.** The SPA calls the API directly at the URL baked in at build time (`VITE_API_BASE_URL`), and the API's `CORS_ORIGINS` allows only the Static Web App. Static Web Apps isn't offered in UK South, so its resource lives in East US 2 (`STATIC_WEB_APP_LOCATION`; metadata only, the files are served from the global edge). Every profile uses the **Free** plan (`STATIC_WEB_APP_SKU=Standard` to change).

\*Estimates only, from list prices at the time of writing, before model tokens and Fabric. Check the [pricing calculator](https://azure.microsoft.com/pricing/calculator/) for your region. The biggest enterprise items are API Management Standard v2 and the AKS nodes; tear the enterprise profile down when you are not using it.

**Live broadcast scale.** Every profile includes Azure Web PubSub for the shared live broadcast: `WEBPUBSUB_UNITS` (default 1 = 1,000 concurrent viewers; 100 = 100,000) and `WEBPUBSUB_SKU` (`Standard_S1` default, `Free_F1` for 20-connection development, `Premium_P1`). Measure delivery latency with `scripts/loadtest-realtime.py` (README §3e).

**Prerequisites for azd**: [azd](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd), Azure CLI, Docker, and for AKS `kubectl` + `kubelogin` (`az aks install-cli`), because local cluster accounts are disabled. Sign in to the subscription you mean to use (a personal one for the hackathon): `az account show`.

### Container Apps (azd)

```bash
azd auth login
azd env new regista && azd env set AZURE_RESOURCE_GROUP rg-regista
azd provision --preview     # what-if
azd up
```

`azd provision --preview` prints only the resource types azd has display names for, so Web PubSub and its hub, the
managed identity, the consumer groups, the Cosmos containers and the role assignments are planned but not listed.
`scripts/preview-all.sh` runs the same what-if through `az` and lists all 48 changes, then a read-only dry run of the
Fabric setup: which items already exist in `FABRIC_WORKSPACE_NAME` and which `postprovision` would create (Fabric
items are not Azure resources, so no Azure preview can show them).

`scripts/deploy.sh` and the GitHub Actions workflows below remain as an alternative path for the same template.

### AKS standard (azd)

```bash
cd deploy/aks
azd env new regaks && azd env set AZURE_RESOURCE_GROUP rg-regista-aks
azd env set AKS_AUTHORIZED_IP_RANGES "$(curl -s https://api.ipify.org)/32"   # optional: lock the API server to you
azd provision --preview && azd up
```

Set `azd env set LETSENCRYPT_EMAIL you@example.com` first. The postprovision hook grants you *Azure Kubernetes Service RBAC Cluster Admin* and AcrPush (by role name; `az role assignment create` is idempotent) and installs cert-manager (pinned v1.21.2). The API gets a stable name from a static public IP with a DNS label (`API_URL`, known at provision time) and a Let's Encrypt certificate; it must be HTTPS because the SPA on Static Web Apps is. The postdeploy hook smoke-tests `/api/health`, checks the API's CORS allows the Static Web App, and checks the site answers. The first certificate can take a minute or two.

### AKS enterprise (azd, deploy from inside the VNet)

```bash
cd deploy/aks-enterprise
azd env new regent && azd env set AZURE_RESOURCE_GROUP rg-regista-ent
azd env set APIM_PUBLISHER_EMAIL you@example.com
azd env set AZURE_DEVOPS_ORG_URL https://dev.azure.com/<org>                       # for the Managed DevOps Pool
azd env set DEVOPS_INFRASTRUCTURE_PRINCIPAL_ID "$(az ad sp list --display-name DevOpsInfrastructure --query '[0].id' -o tsv)"
azd provision --preview
azd provision      # one pass; API_URL is the API Management gateway, WEB_URL the Static Web App
```

Then deploy from the Azure DevOps pipeline (below): its Deploy stage runs on the Managed DevOps Pool inside `snet-agents`, the only place that can reach the private API server and the private registry. API Management is the only public endpoint: its gateway (HTTPS on `*.azure-api.net`, rate-limited per client IP) reaches the internal NGINX ingress on 10.40.4.10 through VNet integration. There is no WAF in this profile; for production, put Front Door Premium or Application Gateway WAF in front of the gateway. The Front Door design, with its pitfalls, is in [ARCHITECTURE.md: Future: Azure Front Door](ARCHITECTURE.md#future-azure-front-door-in-front-of-api-management). For development only, `azd env set AKS_PRIVATE_CLUSTER false` plus `AKS_AUTHORIZED_IP_RANGES` makes the API server public but IP-restricted; the registry and data services stay private, so `azd deploy` from a laptop still needs the in-VNet agent.

Known limits: the AKS application routing add-on's NGINX is supported by Microsoft through November 2026 (Gateway API is the migration path); Fabric Eventstream reads the private Event Hubs namespace through a workspace managed private endpoint (step 5).

### Azure DevOps pipelines

One pipeline per part, each independent: you run the one you want, and nothing runs on its own (nothing on a push,
no pipeline starting another). Each runs its tests first; every deployment is a deployment job on the
environment `regista-<profile>`, so its approval check gates it. Parameter `profile` (default `containerapps`).
*Test everything* is manual too: run it before you deploy; it deploys nothing.

| Pipeline (folder `\Regista`) | File | Runs | What it does |
|---|---|---|---|
| Test everything | `ci.yml` | manual | Ruff, pytest (90% floor), integration, evaluation gate, Vitest (floor), build, Playwright, Bicep, manifests and hooks. Deploys nothing |
| Infrastructure | `infra.yml` | manual | Bicep build + lint → what-if → **Provision** (no application code) |
| API | `api.yml` | manual | API checks → **`azd deploy api`** → deployed integration tests. Enterprise: the deploy runs on the Managed DevOps Pool |
| Frontend | `frontend.yml` | manual | Typecheck, Vitest, build → **`azd deploy web`** (Static Web Apps; `web` is the frontend's azd service name) |
| Functions | `functions.yml` | manual | Dependencies resolve and the app registers its functions → **zip deploy with a remote build** (Flex Consumption) |
| Container jobs | `jobs.yml` | manual | Container Apps: points the feeder job at the image the API runs (run it after an API deploy if the feeder should follow) |
| Full environment | `azure-dev.yml` | manual | Everything in one run: Preview → Provision → Deploy (all services, Functions, the feeder job). For the first setup or a rebuild |

The test steps are shared templates (`templates/api-tests.yml`, `frontend-tests.yml`, `infra-validate.yml`), so CI and the service pipelines run the same checks; the deploy steps too (`azd-steps.yml`, `functions-deploy.yml`, `jobs-update.yml`).

One-time setup (keyless service connection with workload identity federation, the variable group `regista-<profile>` filled from your local azd environment, the environment, all seven pipelines). It signs in with your `az login` when the Azure DevOps organisation uses the same Entra tenant; otherwise export `AZURE_DEVOPS_EXT_PAT`:

```bash
scripts/setup-azure-devops.sh --org https://dev.azure.com/<org> --project <project> --profile containerapps \
  --rg rg-regista --location uksouth --env regista \
  --repo-type github --repo <owner>/<repo> --github-connection <github-service-connection>
```

The organisation needs billing set up (Organization settings → Billing → your subscription) for its free Microsoft-hosted parallel job. Add an approval check on the `regista-<profile>` environment, run *Regista › Full environment* once, then let the per-part pipelines take over. For the enterprise profile, run *Infrastructure* first: it creates the in-VNet agent pool `regista-mdp` (the pipelines' default `managedPool`), which Azure DevOps must find before it starts *Full environment*.

## Idempotency: run it again, nothing changes

Every provision can be re-run safely; a second run changes nothing and fails on nothing.

- **Deterministic names.** Every resource name comes from `infra/modules/naming.bicep` (subscription + resource group + environment); no `newGuid()` or `utcNow()` in a name or a persisted property (the budget start date is a fixed `2026-10-01`).
- **Deterministic role assignments.** Every Bicep role assignment is named `guid(scope, principal, role)`. Roles that Bicep grants are never also granted by a script under another name (that would fail the next run with `RoleAssignmentExists`); `scripts/grant-dev-access.sh` therefore just re-runs provisioning. Roles only scripts grant (AKS RBAC, AcrPush, the Fabric workspace identity, the pipeline principal) are checked first and created only if missing (`deploy/hooks/role-assign.sh`).
- **Images survive re-provisioning.** azd passes `SERVICE_API_IMAGE_NAME`; `scripts/deploy.sh` and `infra.yml` read the running image and pass it back, so a re-run never reverts to the placeholder. After `azd down`, the `preprovision` hook forgets an image whose registry is gone.
- **First rollout (Container Apps).** The first provision runs before any image exists, so the API starts with the placeholder's port 80 and no probes; `azd deploy` swaps only the image. The `postdeploy` hook (`deploy/hooks/containerapps-rollout.sh`) then re-applies the template with the real image (port 8000, probes, feeder command). Later runs find port 8000 and skip it.
- **Incremental mode only**, and settings that Azure can't change in place (Cosmos serverless, AI account sub-domain, private cluster, DNS labels) are fixed per environment.
- **Hooks are find-or-create**: Fabric items, cert-manager (`kubectl apply`), azd environment values.
- **Proof.** Right after a provision, `scripts/check-idempotency.sh` runs the what-if again and fails on any real change: a resource to create or delete, or a property whose value would change. It ignores what-if noise that `azd provision --preview` lists as *Modify*: server-side defaults the template doesn't set (incremental mode keeps them) and values only resolved at deploy time. The Azure DevOps pipeline runs it after every provision.

Two deliberate changes are not re-runs and need a step first: switching the model of an existing deployment (`CHAT_MODEL_NAME`) means deleting that model deployment first; and after `azd down` always use `--purge`, or the soft-deleted Foundry account blocks the next provision with the same name.

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
| `apiServiceSettings` | empty | Overrides of the API's service-contract settings, see below |

### API settings (no hard-coded endpoints, API versions or limits)

The API reads every endpoint, REST path, API version, limit and timeout from its settings (`backend/api/app/config.py`). There are no keys: every Azure call uses a Microsoft Entra token.

- **Deployment-specific values** (the Azure OpenAI, AI Services, Cosmos DB, Storage, Event Hubs, Web PubSub and App Insights endpoints, CORS, the API's own URL) come from the provisioned resources. Container Apps sets them as container app settings; on AKS they reach the pod through the provision outputs and `deploy/k8s/*/10-deployment.tmpl.yaml`.
- **Service-contract values** (the token scope, Speech URL and output format, Translator path and API version, Content Safety paths, API version, text limit and block severity, Azure OpenAI path, timeout and retries, the shared REST client's timeout, the OneLake DFS endpoint) are defined once in `infra/modules/api-settings.bicep` and applied by every profile.

Change one per environment without touching code, then re-provision:

```bash
azd env set API_SERVICE_SETTINGS 'AZURE_CONTENT_SAFETY_API_VERSION=2025-09-15-preview;HTTP_TIMEOUT_S=30'
azd provision
```

The format is `KEY=value` pairs separated by `;`. It's plain text because azd pastes the value into `main.parameters.json` as-is, so quoted JSON would break the file. In pipelines, set the `API_SERVICE_SETTINGS` variable: a GitHub repository variable, or the Azure DevOps variable group. Locally, copy `backend/api/.env.example` to `backend/api/.env`; real environment variables win over the file.

## 3. Build and deploy the apps

GitHub Actions mirrors the Azure DevOps pipelines, with the same names: each part is a separate, manual workflow
(*Run workflow* in the Actions tab, or `gh workflow run`), runs CI's checks first, and waits for the `production`
environment's required reviewer. *Test everything* is manual as well; nothing runs on a push.

| Workflow | File | Runs | What it does |
|---|---|---|---|
| Test everything | `ci.yml` | manual | API and frontend tests (the shared `_api-tests.yml`, `_frontend-tests.yml`), Playwright, Bicep, manifests and hooks |
| Infrastructure | `infra.yml` | manual | What-if (summary on the run page) → **Provision** (Bicep only, keeps the running API image) |
| API | `deploy-api.yml` | manual | API tests → image built by **ACR Tasks** → new revision → deployed integration tests |
| Frontend | `deploy-frontend.yml` | manual | Frontend tests → build with the API's address → **Static Web Apps** upload (token read through OIDC, never stored) → site and CORS check |
| Functions | `deploy-functions.yml` | manual | The app imports and registers its functions → **zip deploy with a remote build** (Flex Consumption) |
| Container jobs | `deploy-jobs.yml` | manual | Points the feeder Container Apps Job at the API's image |
| Full environment | `deploy.yml` | manual | All of the above in one run, for the first deployment or a rebuild |
| Foundry evaluations | `evals.yml` | manual | Groundedness, fact-check and safety evaluations against the deployed models (billed tokens) |

```bash
gh workflow run infra.yml          # first: the infrastructure
gh workflow run deploy.yml         # then everything once; afterwards run each part's workflow when you choose
gh run watch                       # approve each deployment in the Actions tab (production environment)
```

Every workflow signs in with OIDC and finds its resources by tag and type (`.github/actions/azure-context`,
`scripts/ci/find-azure-resources.sh`), not by a deployment name, so it works on an environment provisioned by azd,
Azure Pipelines or `infra.yml`. Infrastructure inputs come from repository variables (`deploy/pipeline-env.txt` lists
them; `scripts/bootstrap-github-oidc.sh` copies them from your azd environment).

**First rollout:** if the API still has the placeholder's port, `deploy-api.yml` applies the template with the new
image so the ports, probes and feeder command switch over; later rollouts create a new revision with
`az containerapp update --image`.

## 4. Run a live match through Event Hubs

The API replays matches in-process by default. To exercise the full event-driven path (feeder → Event Hubs → API / Function / Fabric):

```bash
# Make the API consume Event Hubs (one-off; or set liveSource = 'eventhub' in main.bicepparam)
az containerapp update -g rg-regista -n regista-api --set-env-vars LIVE_SOURCE=eventhub

# Stream a match. 30x plays a full match in about 3.5 minutes; --start-t resumes part-way (seconds of match time).
# (az containerapp job start --args can't pass "--speed": the CLI reads it as its own option, so the script uses the REST API.)
scripts/run-feeder.sh --rg rg-regista --match-id 2026-07-15-england-argentina --speed 30

az containerapp job execution list -g rg-regista -n regista-feeder -o table
```

When the feeder publishes `full_time`, the Function generates the broadcaster recap and writes it to Cosmos DB `recaps` and to `recaps/<match_id>.json` in Blob Storage.

## 5. Microsoft Fabric (Lakehouse + Real-Time Intelligence)

Fabric items (workspace, Lakehouse, Eventhouse, Eventstream) are not Azure Resource Manager resources, so Bicep can't create them; `deploy/hooks/fabric.sh` creates them through the Fabric REST API after `azd provision` (`scripts/fabric-setup.py`, find-or-create, safe to re-run).

1. **Capacity.** Start the free **Fabric trial** once: sign in at https://app.fabric.microsoft.com as the account that runs azd → Account manager → *Start trial*. The script finds the active trial capacity on its own. (Paid alternative: `deployFabricCapacity = true` creates an F2, about $260/month if left running; set `FABRIC_CAPACITY_NAME` to its name.)

2. **Turn the setup on and provision:**

   ```bash
   azd env set FABRIC_WORKSPACE_NAME Regista
   azd provision        # the postprovision hook runs the Fabric setup
   ```

   It creates or reuses:
   - the workspace on your trial capacity
   - Lakehouse `regista_lakehouse`, with the CC0 reference CSVs uploaded to `Files/reference/`
   - Eventhouse `regista_eventhouse`, KQL database `regista_live`, table `match_events` with JSON mapping `match_events_json`
   - Contributor on the workspace for the API's managed identity, so Data Forge can export to OneLake
   - the **workspace identity**, granted *Azure Event Hubs Data Receiver* on the namespace. The Event Hubs namespace has local (SAS) auth disabled; workspace identity is the keyless option Fabric documents for this source.
   - the **Event Hubs connection** `regista-eventhubs-<namespace>` (Connections API: type `EventHub`, endpoint = the
     namespace *name*, hub `match-events`, credential **WorkspaceIdentity**, so no key anywhere). Fabric tests it on
     create, so the hook retries for a few minutes while the role assignment above propagates.
   - the **Eventstream** `regista_live_stream`: source `AzureEventHubExtended` (the portal's *Extended features*; the
     basic Event Hubs source accepts only shared keys) on consumer group `fabric`, starting at `Earliest`, into
     `match_events` with processed ingestion (JSON fields map to columns by name).

   It then stores `ONELAKE_WORKSPACE` and `ONELAKE_LAKEHOUSE` in the azd environment; run `azd provision` (Container Apps) or `azd deploy` (AKS) once more to give them to the API.

3. **Idempotent.** Every item is found by name before it is created; a re-run prints `exists` and changes nothing
   (`scripts/preview-all.sh` includes a read-only Fabric dry run). Nothing to do by hand.

   **Rebuilding the resource group.** Fabric items live in the Fabric workspace, not in the resource group, so deleting
   the group leaves them. The next `azd up` recreates the Azure resources (same names for the same group and
   environment name) and the hook re-grants the workspace identity on the new namespace and the new API identity on the
   workspace. If the namespace name changed (another group or environment name), the hook sees that the existing
   Eventstream's connection points at the old namespace, creates a connection to the new one and re-points the
   Eventstream. Deleting the workspace as well is fine: the hook recreates it, with every item, on your trial capacity. Only if Fabric refuses the
   connection (a tenant setting, or the private enterprise namespace failing Fabric's connection test) does the hook
   print a portal fallback: create it under *Settings → Manage connections and gateways* (Azure Event Hubs, namespace
   name, hub `match-events`, *Workspace identity*), then `azd env set FABRIC_EVENTHUB_CONNECTION_ID <id>` and
   `azd hooks run postprovision`.

   Enterprise profile: the Event Hubs namespace has no public access, so the hook also creates a workspace **managed
   private endpoint** `mpe-regista-eventhubs` to it (Fabric REST API, subresource `namespace`) and approves the request
   on the namespace (`az network private-endpoint-connection approve`); Fabric supports this on trial and F capacities,
   UK South included. Fabric takes a few minutes to provision it; if it is still pending, `azd hooks run postprovision`
   approves it. Fabric tests a new connection from its shared service, which the private namespace may refuse; then
   the hook prints the portal fallback from step 3. Data preview in the Eventstream editor may also be unavailable.

   Inbound private access to the Eventhouse (a workspace-level private link, `Microsoft.Fabric/privateLinkServicesForFabric`)
   is a separate feature and is not set up: it needs a paid F capacity (not the trial), and Fabric documents that a
   private-link Eventhouse can't consume events from an Eventstream, which would break this live path.

4. **Feed it.** Run the feeder so events flow (`scripts/run-feeder.sh --rg rg-regista --speed 30`, or `kubectl -n regista create job feeder-$(date +%s) --from=cronjob/regista-feeder` on AKS).

5. **Tested.** On 2026-10-22 the hook created the connection and the Eventstream against the live `PremierLeague`
   workspace (trial capacity, UK South); the Eventstream topology reports source, stream and Eventhouse destination
   *Running*, and a third run changed nothing. A Fabric failure never fails `azd provision`: the hook reports it and
   you re-run it with `azd hooks run postprovision`.

6. **From Azure Pipelines.** The hook runs as the pipeline's service principal. Add `FABRIC_WORKSPACE_NAME` (and, once
   you created the connection by hand, `FABRIC_EVENTHUB_CONNECTION_ID`) to the variable group, enable the Fabric tenant setting *Service principals
   can call Fabric public APIs*, and add the service principal `regista-pipeline-<profile>` as **Admin** of the workspace
   (Workspace → Manage access). It can't see your personal trial capacity, so it reuses the capacity the workspace is
   already on. Connections belong to whoever creates them: once the Eventstream exists the hook skips the connection
   step, so a pipeline run never needs to see the one your account created.

7. **Query.** Open the KQL queryset on `regista_live` and paste the queries from `docs/kql/`:
   - `live-momentum.kql`: xT added per minute per team
   - `shots-by-team.kql`: shots, xG and finishing delta
   - `ingest-latency.kql`: p50/p95/p99 from feeder to Eventhouse (needs the feeder to stamp `emitted_at`)

8. **Real results next to the reconstructions.** In a Lakehouse notebook, or the SQL analytics endpoint after loading the CSVs as tables:

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
# paste the printed values into backend/api/.env (template: backend/api/.env.example)
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
| `postdeploy`: `/api/health did not answer within 5 minutes` (Container Apps, first `azd up`) | The API still had the placeholder's port 80. Fixed by the first-rollout step in the hook; on an older checkout run `azd provision` (or `azd hooks run postdeploy`) once. Check with `az containerapp revision list -n regista-api -g <rg> -o table`: a revision in *ActivationFailed* with port 80 is this case. |
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
