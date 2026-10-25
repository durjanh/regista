// Regista on AKS (enterprise profile): API Management is the only public endpoint.
//
//   Browser ─HTTPS─▶ Azure Static Web Apps (React SPA, global edge)
//   Browser ─HTTPS─▶ API Management Standard v2 (policies, rate limits) ─VNet integration─▶ internal NGINX ingress
//            ─▶ AKS (private API server) ─private endpoints─▶ ACR · Storage · Cosmos DB · Event Hubs · Foundry
//
// Deploys run from a Managed DevOps Pool inside the VNet (the private API server and registry are unreachable
// from outside). Deployed by azd from deploy/aks-enterprise/azure.yaml in a single `azd provision`.
// No WAF in this profile: for production, put Front Door Premium or Application Gateway WAF in front of the gateway.

targetScope = 'resourceGroup'

import { token, dashed } from '../modules/naming.bicep'
import { apiServiceSettings, parseApiServiceSettings } from '../modules/api-settings.bicep'

@minLength(3)
@maxLength(12)
param environmentName string

param location string = resourceGroup().location

param deployerPrincipalId string = ''

@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param deployerPrincipalType string = 'User'

param chatModel object = {
  name: 'gpt-5.4-mini'
  version: '2026-03-17'
}
param reasoningModel object = {
  name: 'gpt-5.5'
  version: '2026-04-24'
}
param modelSku string = 'GlobalStandard'
param chatCapacity int = 100
param reasoningCapacity int = 50

@allowed([
  'Free'
  'Standard'
])
@description('Free tier by default (no control-plane charge). Standard adds the uptime SLA: azd env set AKS_TIER Standard.')
param aksTier string = 'Free'
@description('VM size for the nodes. v6 by default: new subscriptions often have 0 quota for the v5 families (check: az vm list-usage -l uksouth).')
param aksNodeVmSize string = 'Standard_D4ds_v6'

@description('Node counts as strings (azd substitutes parameters as text). 2 x 4 vCPU + the 2 vCPU agent = a new subscription\'s 10 vCPU limit; raise both after a quota increase.')
param aksNodeMinCount string = '2'
param aksNodeMaxCount string = '2'

// Not v6/v7: Azure Pipelines agent images don't support their disk controller (Microsoft Learn, Managed DevOps Pools
// "Configure images"). Standard_D2ads_v5 is the Managed DevOps Pools default size. Pools have their own core quota
// (Quotas > Managed DevOps Pools), separate from the subscription's compute quota.
@description('Managed DevOps Pool agent size (not v6/v7: Azure Pipelines images do not support them).')
param agentVmSize string = 'Standard_D2ads_v5'

// The pool's name in Azure DevOps. Fixed, not per-environment: the pipelines reference it at queue time
// (managedPool, default 'regista-mdp'), before any output exists. One enterprise environment per organisation.
@description('Managed DevOps Pool name, as the pipelines refer to it (managedPool parameter).')
param devOpsPoolName string = 'regista-mdp'

@allowed([
  'true'
  'false'
])
@description('Private (default). \'false\' is for development only: the API server becomes public, limited to aksAuthorizedIpRanges. A string because azd substitutes parameters as text.')
param aksPrivateCluster string = 'true'

@description('Comma-separated CIDRs for the API server when aksPrivateCluster is false.')
param aksAuthorizedIpRanges string = ''

@description('Static private IP of the internal NGINX ingress (inside snet-ingress, 10.40.4.0/24).')
param ingressPrivateIp string = '10.40.4.10'

param apimPublisherEmail string

@allowed([
  'StandardV2'
  'PremiumV2'
])
param apimSku string = 'StandardV2'

@description('Calls per minute per client IP at the gateway.')
param apimCallsPerMinute int = 600

@description('Static Web Apps region (metadata only; files are served from the global edge). Not offered in UK South; West Europe refuses some new subscriptions.')
param staticWebAppLocation string = 'eastus2'

@allowed([
  'Free'
  'Standard'
])
@description('Static Web Apps plan. Free by default; Standard adds the SLA and custom domains with private endpoints.')
param staticWebAppSku string = 'Free'

@description('Azure DevOps organization URL for the Managed DevOps Pool. Empty = no pool (deploy with az aks command invoke).')
param azureDevOpsOrganizationUrl string = ''

@description('Object id of the tenant\'s DevOpsInfrastructure service principal (scripts/setup-azure-devops.sh prints it).')
param devOpsInfrastructurePrincipalId string = ''

param deployFunctions bool = true

@allowed([
  'Free_F1'
  'Standard_S1'
  'Premium_P1'
])
@description('Web PubSub tier for the shared live broadcast (1,000 concurrent viewers per Standard unit).')
param webPubSubSku string = 'Standard_S1'

@description('Web PubSub units as a string (azd substitutes text): 1 = 1,000 viewers, 100 = 100,000.')
param webPubSubUnits string = '1'

@description('Overrides of the API\'s service-contract settings (REST paths, API versions, limits, timeouts; modules/api-settings.bicep) as "KEY=value;KEY=value". Empty = defaults.')
param apiServiceSettingsOverrides string = ''

@description('Fabric OneLake workspace and lakehouse for Data Forge exports (set by deploy/hooks/fabric.sh). Empty = none.')
param oneLakeWorkspace string = ''
param oneLakeLakehouse string = ''
param budgetContactEmail string = ''
param budgetAmount string = '1400'
param budgetStartDate string = utcNow('yyyy-MM-01')
param deployFabricCapacity bool = false
param fabricAdminEmail string = ''
param tags object = {}

var tok = token(subscription().subscriptionId, resourceGroup().id, environmentName)
var allTags = union({
  'azd-env-name': environmentName
  project: 'regista'
  profile: 'aks-enterprise'
  workload: 'inside-the-game-hackathon'
  ManagedBy: 'IaC'
}, tags)

var zones = {
  registry: 'privatelink.azurecr.io'
  blob: 'privatelink.blob.${environment().suffixes.storage}'
  queue: 'privatelink.queue.${environment().suffixes.storage}'
  table: 'privatelink.table.${environment().suffixes.storage}'
  cosmos: 'privatelink.documents.azure.com'
  eventHubs: 'privatelink.servicebus.windows.net'
  cognitive: 'privatelink.cognitiveservices.azure.com'
  openai: 'privatelink.openai.azure.com'
  foundry: 'privatelink.services.ai.azure.com'
  webPubSub: 'privatelink.webpubsub.azure.com'
}

// ---------------------------------------------------------------------------------------------
// Platform (shared with every profile), locked to private access
// ---------------------------------------------------------------------------------------------

module platform '../modules/platform.bicep' = {
  name: 'platform'
  params: {
    location: location
    tags: allTags
    environmentName: environmentName
    tok: tok
    deployerPrincipalId: deployerPrincipalId
    deployerPrincipalType: deployerPrincipalType
    chatModel: chatModel
    reasoningModel: reasoningModel
    modelSku: modelSku
    chatCapacity: chatCapacity
    reasoningCapacity: reasoningCapacity
    publicNetworkAccess: 'Disabled'
    registrySku: 'Premium'
    budgetContactEmail: budgetContactEmail
    budgetAmount: int(budgetAmount)
    budgetStartDate: budgetStartDate
    deployFabricCapacity: deployFabricCapacity
    fabricAdminEmail: fabricAdminEmail
    webPubSubSku: webPubSubSku
    webPubSubUnits: int(webPubSubUnits)
    webPubSubPrivateServerTraffic: true
  }
}

// ---------------------------------------------------------------------------------------------
// Network: VNet, private DNS, private endpoints
// ---------------------------------------------------------------------------------------------

module network '../modules/network.bicep' = {
  name: 'network'
  params: {
    location: location
    tags: allTags
    vnetName: dashed('vnet', environmentName, tok)
  }
}

module dns '../modules/private-dns.bicep' = {
  name: 'private-dns'
  params: {
    tags: allTags
    vnetId: network.outputs.id
    zones: map(items(zones), z => z.value)
  }
}

// Keys only, so the loop is known at the start of the deployment; the ids come from the platform outputs.
var endpoints = [
  { key: 'registry', target: 'registry', group: 'registry', zoneKeys: ['registry'] }
  { key: 'blob', target: 'storage', group: 'blob', zoneKeys: ['blob'] }
  { key: 'queue', target: 'storage', group: 'queue', zoneKeys: ['queue'] }
  { key: 'table', target: 'storage', group: 'table', zoneKeys: ['table'] }
  { key: 'cosmos', target: 'cosmos', group: 'Sql', zoneKeys: ['cosmos'] }
  { key: 'eventhubs', target: 'eventHubs', group: 'namespace', zoneKeys: ['eventHubs'] }
  { key: 'foundry', target: 'foundry', group: 'account', zoneKeys: ['cognitive', 'openai', 'foundry'] }
  { key: 'webpubsub', target: 'webPubSub', group: 'webpubsub', zoneKeys: ['webPubSub'] }
]

var targets = {
  registry: platform.outputs.registryId
  storage: platform.outputs.storageId
  cosmos: platform.outputs.cosmosId
  eventHubs: platform.outputs.eventHubsId
  foundry: platform.outputs.aiAccountId
  webPubSub: platform.outputs.webPubSubId
}

module privateEndpoints '../modules/private-endpoint.bicep' = [
  for e in endpoints: {
    name: 'pe-${e.key}'
    params: {
      location: location
      tags: allTags
      name: dashed('pe-${e.key}', environmentName, tok)
      subnetId: network.outputs.privateEndpointSubnetId
      targetId: targets[e.target]
      groupId: e.group
      zoneIds: map(e.zoneKeys, k => dns.outputs.zoneIds[zones[k]])
    }
  }
]

// ---------------------------------------------------------------------------------------------
// Compute: private AKS, internal ingress
// ---------------------------------------------------------------------------------------------

module aks '../modules/aks.bicep' = {
  name: 'aks'
  params: {
    location: location
    tags: allTags
    clusterName: dashed('aks', environmentName, tok)
    controlPlaneIdentityName: dashed('id-aks', environmentName, tok)
    workloadIdentityName: platform.outputs.identityName
    registryName: platform.outputs.registryName
    logAnalyticsId: platform.outputs.logAnalyticsId
    tier: aksTier
    nodeVmSize: aksNodeVmSize
    nodeMinCount: int(aksNodeMinCount)
    nodeMaxCount: int(aksNodeMaxCount)
    nodeSubnetId: network.outputs.aksSubnetId
    vnetName: network.outputs.name
    privateCluster: aksPrivateCluster == 'true'
    authorizedIpRanges: empty(aksAuthorizedIpRanges) ? [] : map(split(aksAuthorizedIpRanges, ','), r => trim(r))
    enableAzurePolicy: true
  }
}

// ---------------------------------------------------------------------------------------------
// Edge: API Management Standard v2 (public gateway) -> VNet integration -> internal ingress
// ---------------------------------------------------------------------------------------------

module apim '../modules/apim.bicep' = {
  name: 'apim'
  params: {
    location: location
    tags: allTags
    name: dashed('apim', environmentName, tok)
    publisherEmail: apimPublisherEmail
    sku: apimSku
    subnetId: network.outputs.apimSubnetId
    logAnalyticsId: platform.outputs.logAnalyticsId
  }
}

// The React SPA on the Free plan (STATIC_WEB_APP_SKU=Standard adds the SLA). Static files are public by nature; it calls
// the API Management gateway.
module staticWebApp '../modules/staticwebapp.bicep' = {
  name: 'staticwebapp'
  params: {
    tags: allTags
    name: dashed('swa', environmentName, tok)
    location: staticWebAppLocation
    sku: staticWebAppSku
  }
}

module apimApi '../modules/apim-api.bicep' = {
  name: 'apim-api'
  params: {
    apimName: apim.outputs.name
    ingressPrivateIp: ingressPrivateIp
    callsPerMinute: apimCallsPerMinute
  }
}

// ---------------------------------------------------------------------------------------------
// Recap automation (VNet-integrated) and the in-VNet deployment agents
// ---------------------------------------------------------------------------------------------

module functions '../modules/functions.bicep' = if (deployFunctions) {
  name: 'functions'
  params: {
    location: location
    tags: allTags
    planName: dashed('plan', environmentName, tok)
    appName: dashed('func', environmentName, tok)
    identityId: platform.outputs.identityId
    identityClientId: platform.outputs.identityClientId
    storageAccountName: platform.outputs.storageName
    storageBlobEndpoint: platform.outputs.storageBlobEndpoint
    deploymentContainer: platform.outputs.functionsDeploymentContainer
    eventHubFqdn: platform.outputs.eventHubFqdn
    eventHubName: platform.outputs.eventHubName
    cosmosEndpoint: platform.outputs.cosmosEndpoint
    cosmosDatabase: platform.outputs.cosmosDatabase
    apiUrl: 'https://${apim.outputs.gatewayHost}'
    appInsightsConnectionString: platform.outputs.appInsightsConnectionString
    subnetId: network.outputs.functionsSubnetId
  }
  dependsOn: [
    privateEndpoints
  ]
}

module devOpsPool '../modules/devops-pool.bicep' = if (!empty(azureDevOpsOrganizationUrl) && !empty(devOpsInfrastructurePrincipalId)) {
  name: 'devops-pool'
  params: {
    location: location
    tags: allTags
    devCenterName: take(dashed('dc', environmentName, tok), 26)
    projectName: dashed('dcp', environmentName, tok)
    poolName: devOpsPoolName
    organizationUrl: azureDevOpsOrganizationUrl
    devOpsInfrastructurePrincipalId: devOpsInfrastructurePrincipalId
    vnetName: network.outputs.name
    subnetId: network.outputs.agentsSubnetId
    vmSize: agentVmSize
  }
}

// ---------------------------------------------------------------------------------------------
// Outputs: azd environment values; deploy/k8s manifests read them as {{.Env.NAME}}.
// ---------------------------------------------------------------------------------------------

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output DEPLOYMENT_PROFILE string = 'aks-enterprise'
output AZURE_AKS_CLUSTER_NAME string = aks.outputs.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = platform.outputs.registryLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = platform.outputs.registryName
output INGRESS_CLASS string = 'nginx-internal'
output INGRESS_PRIVATE_IP string = ingressPrivateIp
output INGRESS_SUBNET string = network.outputs.ingressSubnetName
output APIM_NAME string = apim.outputs.name
output APIM_ID string = apim.outputs.id
output API_URL string = 'https://${apim.outputs.gatewayHost}'
output WEB_URL string = staticWebApp.outputs.url
output STATIC_WEB_APP_NAME string = staticWebApp.outputs.name
output AZURE_DEVOPS_POOL_NAME string = (!empty(azureDevOpsOrganizationUrl) && !empty(devOpsInfrastructurePrincipalId)) ? devOpsPoolName : ''
output AZURE_CLIENT_ID string = platform.outputs.identityClientId
output IDENTITY_NAME string = platform.outputs.identityName
output WEBPUBSUB_ENDPOINT string = platform.outputs.webPubSubEndpoint
output WEBPUBSUB_HUB string = platform.outputs.webPubSubHub
output ONELAKE_WORKSPACE string = oneLakeWorkspace
output ONELAKE_LAKEHOUSE string = oneLakeLakehouse
output AZURE_OPENAI_ENDPOINT string = platform.outputs.openAiEndpoint
output AZURE_OPENAI_CHAT_DEPLOYMENT string = platform.outputs.chatDeploymentName
output AZURE_OPENAI_REASONING_DEPLOYMENT string = platform.outputs.reasoningDeploymentName
output FOUNDRY_PROJECT_ENDPOINT string = platform.outputs.projectEndpoint
output AZURE_AI_SERVICES_ENDPOINT string = platform.outputs.aiServicesEndpoint
output AZURE_AI_SERVICES_RESOURCE_ID string = platform.outputs.aiAccountId
output COSMOS_ENDPOINT string = platform.outputs.cosmosEndpoint
output COSMOS_DATABASE string = platform.outputs.cosmosDatabase
output STORAGE_ACCOUNT_URL string = platform.outputs.storageBlobEndpoint
output EVENTHUB_FQDN string = platform.outputs.eventHubFqdn
output EVENTHUB_NAME string = platform.outputs.eventHubName
output APPLICATIONINSIGHTS_CONNECTION_STRING string = platform.outputs.appInsightsConnectionString
output FUNCTION_APP_NAME string = deployFunctions ? dashed('func', environmentName, tok) : ''
output FABRIC_CAPACITY_NAME string = platform.outputs.fabricCapacityName

// The API's service-contract settings, for the Kubernetes manifests (deploy/k8s/*/10-deployment.tmpl.yaml)
var apiSettings = apiServiceSettings(parseApiServiceSettings(apiServiceSettingsOverrides))
output AZURE_COGNITIVE_SCOPE string = apiSettings.AZURE_COGNITIVE_SCOPE
output AZURE_TOKEN_REFRESH_MARGIN_S string = apiSettings.AZURE_TOKEN_REFRESH_MARGIN_S
output HTTP_TIMEOUT_S string = apiSettings.HTTP_TIMEOUT_S
output AZURE_OPENAI_API_PATH string = apiSettings.AZURE_OPENAI_API_PATH
output AZURE_OPENAI_TIMEOUT_S string = apiSettings.AZURE_OPENAI_TIMEOUT_S
output AZURE_OPENAI_MAX_RETRIES string = apiSettings.AZURE_OPENAI_MAX_RETRIES
output AZURE_SPEECH_TTS_URL string = apiSettings.AZURE_SPEECH_TTS_URL
output AZURE_SPEECH_OUTPUT_FORMAT string = apiSettings.AZURE_SPEECH_OUTPUT_FORMAT
output AZURE_TRANSLATOR_PATH string = apiSettings.AZURE_TRANSLATOR_PATH
output AZURE_TRANSLATOR_API_VERSION string = apiSettings.AZURE_TRANSLATOR_API_VERSION
output AZURE_CONTENT_SAFETY_API_VERSION string = apiSettings.AZURE_CONTENT_SAFETY_API_VERSION
output AZURE_CONTENT_SAFETY_ANALYZE_PATH string = apiSettings.AZURE_CONTENT_SAFETY_ANALYZE_PATH
output AZURE_CONTENT_SAFETY_SHIELD_PATH string = apiSettings.AZURE_CONTENT_SAFETY_SHIELD_PATH
output AZURE_CONTENT_SAFETY_MAX_CHARS string = apiSettings.AZURE_CONTENT_SAFETY_MAX_CHARS
output REGISTA_VIDEO_SAFE string = apiSettings.REGISTA_VIDEO_SAFE
output AZURE_CONTENT_SAFETY_BLOCK_SEVERITY string = apiSettings.AZURE_CONTENT_SAFETY_BLOCK_SEVERITY
output BROADCAST_VIEWER_COUNT_INTERVAL_S string = apiSettings.BROADCAST_VIEWER_COUNT_INTERVAL_S
output BROADCAST_VIEWER_COUNT_MAX string = apiSettings.BROADCAST_VIEWER_COUNT_MAX
output ONELAKE_DFS_ENDPOINT string = apiSettings.ONELAKE_DFS_ENDPOINT
