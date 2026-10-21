// Regista on AKS (standard profile): the same platform as Container Apps, with the API, web app and feeder on a
// keyless AKS cluster. Public ingress through the application routing add-on; PaaS services stay public with
// Entra-only auth (no keys anywhere). Deployed by azd from deploy/aks/azure.yaml:
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
param aksNodeVmSize string = 'Standard_D4ds_v5'
param aksNodeMinCount int = 1
param aksNodeMaxCount int = 3

@description('Comma-separated CIDRs allowed to reach the AKS API server (your IP, the pipeline\'s egress). Empty = any, still Entra-only.')
param aksAuthorizedIpRanges string = ''

param deployFunctions bool = true

@description('Public URL of the app (set by the postdeploy hook once the ingress has an address), for the recap Function.')
param publicUrl string = ''
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
    nodeMinCount: aksNodeMinCount
    nodeMaxCount: aksNodeMaxCount
    authorizedIpRanges: empty(aksAuthorizedIpRanges) ? [] : map(split(aksAuthorizedIpRanges, ','), r => trim(r))
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
    // The ingress address is only known after the first `azd deploy`; the postdeploy hook stores it as REGISTA_PUBLIC_URL.
    apiUrl: publicUrl
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
output INGRESS_CLASS string = 'webapprouting.kubernetes.azure.com'
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
