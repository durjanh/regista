// Regista on AKS (standard profile): the same platform as Container Apps, with the API and feeder on a keyless AKS
// cluster and the React front end on Azure Static Web Apps. The API is published by an app-routing NGINX controller
// on a static public IP with a DNS label, with HTTPS from cert-manager + Let's Encrypt (the SPA is HTTPS, so the API
// must be too). PaaS services stay public with Entra-only auth (no keys anywhere). Deployed by azd from deploy/aks:
//
//   cd deploy/aks && azd up
//
// What-if first (azd provision --preview), incremental mode, deterministic names, idempotent role assignments.

targetScope = 'resourceGroup'

import { token, dashed } from '../modules/naming.bicep'

@minLength(3)
@maxLength(12)
param environmentName string

param location string = resourceGroup().location

@description('Object id of whoever runs azd (user or pipeline principal). Granted data-plane roles for local runs.')
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
param aksTier string = 'Free'
@description('VM size for the nodes. v6 by default: new subscriptions often have 0 quota for the v5 families (check: az vm list-usage -l uksouth).')
param aksNodeVmSize string = 'Standard_D4ds_v6'

@description('Node counts as strings (azd substitutes parameters as text). 1-2 x 4 vCPU fits a new subscription\'s 10 vCPU limit.')
param aksNodeMinCount string = '1'
param aksNodeMaxCount string = '2'

@description('Comma-separated CIDRs allowed to reach the AKS API server (your IP, the pipeline\'s egress). Empty = any, still Entra-only.')
param aksAuthorizedIpRanges string = ''

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

@description('Fabric OneLake workspace and lakehouse for Data Forge exports (set by deploy/hooks/fabric.sh). Empty = none.')
param oneLakeWorkspace string = ''
param oneLakeLakehouse string = ''

@allowed([
  'Free'
  'Standard'
])
param staticWebAppSku string = 'Free'

@description('Static Web Apps region (metadata only; files are served from the global edge). Not offered in UK South; West Europe refuses some new subscriptions.')
param staticWebAppLocation string = 'eastus2'
param budgetContactEmail string = ''
@description('Monthly budget (string because azd substitutes parameters as text).')
param budgetAmount string = '300'
param budgetStartDate string = utcNow('yyyy-MM-01')
param deployFabricCapacity bool = false
param fabricAdminEmail string = ''
param tags object = {}

var tok = token(subscription().subscriptionId, resourceGroup().id, environmentName)
var allTags = union({
  'azd-env-name': environmentName
  project: 'regista'
  profile: 'aks'
  workload: 'inside-the-game-hackathon'
  ManagedBy: 'IaC'
}, tags)

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
    budgetContactEmail: budgetContactEmail
    budgetAmount: int(budgetAmount)
    budgetStartDate: budgetStartDate
    deployFabricCapacity: deployFabricCapacity
    fabricAdminEmail: fabricAdminEmail
    webPubSubSku: webPubSubSku
    webPubSubUnits: int(webPubSubUnits)
  }
}

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
    authorizedIpRanges: empty(aksAuthorizedIpRanges) ? [] : map(split(aksAuthorizedIpRanges, ','), r => trim(r))
  }
}

// Stable public address for the API: a static IP with a DNS label (<label>.<region>.cloudapp.azure.com). The
// nginx-public controller (deploy/k8s/aks) binds to it, and cert-manager gets a Let's Encrypt certificate for the name.
var apiDnsLabel = 'regista-${environmentName}-${tok}'
var networkContributorRoleId = '4d97b98b-1d4f-4787-a291-c67834d212e7'   // verified on Microsoft Learn

resource ingressIp 'Microsoft.Network/publicIPAddresses@2024-07-01' = {
  name: dashed('pip-ingress', environmentName, tok)
  location: location
  tags: allTags
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: {
      domainNameLabel: apiDnsLabel
    }
  }
}

// The AKS control plane attaches the IP to the controller's load balancer.
resource ingressIpRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(ingressIp.id, aks.name, networkContributorRoleId)
  scope: ingressIp
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', networkContributorRoleId)
    principalId: aks.outputs.controlPlanePrincipalId
    principalType: 'ServicePrincipal'
  }
}

var apiUrl = 'https://${ingressIp.properties.dnsSettings.fqdn}'

module staticWebApp '../modules/staticwebapp.bicep' = {
  name: 'staticwebapp'
  params: {
    tags: allTags
    name: dashed('swa', environmentName, tok)
    location: staticWebAppLocation
    sku: staticWebAppSku
  }
}

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
    apiUrl: apiUrl
    appInsightsConnectionString: platform.outputs.appInsightsConnectionString
  }
}

// ---------------------------------------------------------------------------------------------
// Outputs: azd stores them in the environment; deploy/k8s manifests read them as {{.Env.NAME}}.
// ---------------------------------------------------------------------------------------------

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output DEPLOYMENT_PROFILE string = 'aks'
output AZURE_AKS_CLUSTER_NAME string = aks.outputs.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = platform.outputs.registryLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = platform.outputs.registryName
output INGRESS_CLASS string = 'nginx-public'
output INGRESS_PIP_NAME string = ingressIp.name
output INGRESS_PIP_RESOURCE_GROUP string = resourceGroup().name
output API_HOST string = ingressIp.properties.dnsSettings.fqdn
output API_URL string = apiUrl
output WEB_URL string = staticWebApp.outputs.url
output STATIC_WEB_APP_NAME string = staticWebApp.outputs.name
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
