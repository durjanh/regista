// Regista on AKS (enterprise profile): API Management is the only public endpoint.
//
//   Internet ─HTTPS─▶ API Management Standard v2 (policies, rate limits) ─VNet integration─▶ internal NGINX ingress
//            ─▶ AKS (private API server) ─private endpoints─▶ ACR · Storage · Cosmos DB · Event Hubs · Foundry
//
// Deploys run from a Managed DevOps Pool inside the VNet (the private API server and registry are unreachable
// from outside). Deployed by azd from deploy/aks-enterprise/azure.yaml in a single `azd provision`.
// No WAF in this profile: for production, put Front Door Premium or Application Gateway WAF in front of the gateway.

targetScope = 'resourceGroup'

import { token, dashed } from '../modules/naming.bicep'

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
param aksTier string = 'Standard'
param aksNodeVmSize string = 'Standard_D4ds_v5'
param aksNodeMinCount int = 2
param aksNodeMaxCount int = 4

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

@description('Azure DevOps organization URL for the Managed DevOps Pool. Empty = no pool (deploy with az aks command invoke).')
param azureDevOpsOrganizationUrl string = ''

@description('Object id of the tenant\'s DevOpsInfrastructure service principal (scripts/setup-azure-devops.sh prints it).')
param devOpsInfrastructurePrincipalId string = ''

param deployFunctions bool = true
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
]

var targets = {
  registry: platform.outputs.registryId
  storage: platform.outputs.storageId
  cosmos: platform.outputs.cosmosId
  eventHubs: platform.outputs.eventHubsId
  foundry: platform.outputs.aiAccountId
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
    nodeMinCount: aksNodeMinCount
    nodeMaxCount: aksNodeMaxCount
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
    poolName: dashed('mdp', environmentName, tok)
    organizationUrl: azureDevOpsOrganizationUrl
    devOpsInfrastructurePrincipalId: devOpsInfrastructurePrincipalId
    vnetName: network.outputs.name
    subnetId: network.outputs.agentsSubnetId
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
output REGISTA_PUBLIC_URL string = 'https://${apim.outputs.gatewayHost}'
output AZURE_DEVOPS_POOL_NAME string = (!empty(azureDevOpsOrganizationUrl) && !empty(devOpsInfrastructurePrincipalId)) ? dashed('mdp', environmentName, tok) : ''
output AZURE_CLIENT_ID string = platform.outputs.identityClientId
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
