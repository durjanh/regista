// Regista — AI match intelligence platform. Resource-group scoped, keyless, idempotent.
//
//   az deployment group what-if -g <rg> -f infra/main.bicep -p infra/main.bicepparam
//   az deployment group create  -g <rg> -f infra/main.bicep -p infra/main.bicepparam
//
// Every data-plane call uses Microsoft Entra ID through one user-assigned managed identity.
// Local/key auth is disabled on Foundry, Cosmos DB, Event Hubs and Storage.

targetScope = 'resourceGroup'

import { token, compact, dashed } from 'modules/naming.bicep'
import { apiServiceEnv, parseApiServiceSettings } from 'modules/api-settings.bicep'

@minLength(3)
@maxLength(12)
@description('Short environment name used in every resource name.')
param environmentName string = 'regista'

@description('Region for all resources. UK South has Global Standard capacity for the default models.')
param location string = resourceGroup().location

@description('Object id of the user or service principal running deployments. Granted data-plane roles so the API can run locally against Azure. Leave empty to skip.')
param deployerPrincipalId string = ''

@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param deployerPrincipalType string = 'User'

@description('Placeholder image used until the first real build lands in ACR (empty-registry first deploy).')
param placeholderImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('API container image. The workflows pass the current image so re-running infra never reverts a deployment.')
param apiImage string = placeholderImage

@description('Fast model for live narration and translation. Verified Global Standard in uksouth: gpt-5.4-mini 2026-03-17.')
param chatModel object = {
  name: 'gpt-5.4-mini'
  version: '2026-03-17'
}

@description('Stronger model for recaps and agents. Verified Global Standard in uksouth: gpt-5.5 2026-04-24.')
param reasoningModel object = {
  name: 'gpt-5.5'
  version: '2026-04-24'
}

@allowed([
  'GlobalStandard'
  'DataZoneStandard'
  'Standard'
])
param modelSku string = 'GlobalStandard'

@description('Chat deployment capacity in thousands of tokens per minute.')
param chatCapacity int = 100

@description('Reasoning deployment capacity in thousands of tokens per minute.')
param reasoningCapacity int = 50

@allowed([
  'replay'
  'eventhub'
])
@description('Live source for the API: in-process replay, or the Event Hubs pipeline fed by the feeder job.')
param liveSource string = 'replay'

@description('Fabric OneLake workspace for Data Forge exports (set after running scripts/fabric-setup.py).')
param oneLakeWorkspace string = ''

@description('Fabric OneLake lakehouse for Data Forge exports.')
param oneLakeLakehouse string = ''

@description('Deploy the Azure Functions recap automation.')
param deployFunctions bool = true

@description('Deploy a Fabric F2 capacity. Bills while running; prefer a Fabric trial for the hackathon.')
param deployFabricCapacity bool = false

@description('Fabric capacity admin (Entra UPN). Required when deployFabricCapacity is true.')
param fabricAdminEmail string = ''

param tags object = {}

@description('API minimum replicas. 0 = scale to zero (pay nothing while idle; ~20-40 s cold start on the first request). Set 1 while judging or recording.')
@minValue(0)
@maxValue(1)
param apiMinReplicas int = 0

@description('Overrides of the API\'s service-contract settings (REST paths, API versions, limits, timeouts; modules/api-settings.bicep) as "KEY=value;KEY=value". Empty = defaults.')
param apiServiceSettings string = ''

@description('Log Analytics daily ingestion cap in GB (cost guardrail; ingestion pauses for the rest of the day when reached). -1 = no cap.')
param logDailyCapGb int = 1

@allowed([
  'Free_F1'
  'Standard_S1'
  'Premium_P1'
])
@description('Web PubSub tier for the shared live broadcast. Standard_S1: 1,000 concurrent viewers per unit.')
param webPubSubSku string = 'Standard_S1'

@description('Web PubSub units: 1 = 1,000 concurrent viewers, 100 = 100,000 (billed per unit-day).')
param webPubSubUnits int = 1

@allowed([
  'Free'
  'Standard'
])
@description('Static Web Apps plan for the React front end. Free has no SLA; Standard adds it.')
param staticWebAppSku string = 'Free'

@description('Static Web Apps region (metadata only; files are served from the global edge). Not offered in UK South; West Europe refuses some new subscriptions.')
param staticWebAppLocation string = 'eastus2'

@description('E-mail for the monthly cost budget alerts (50%, 90% actual; 100% forecast). Leave empty to skip the budget.')
param budgetContactEmail string = ''

@description('Monthly budget in the billing currency.')
param budgetAmount int = 150

@description('Budget start (first day of the current month). Defaults to this month at deployment time.')
param budgetStartDate string = utcNow('yyyy-MM-01')

// ---------------------------------------------------------------------------------------------
// Names (deterministic)
// ---------------------------------------------------------------------------------------------

var tok = token(subscription().subscriptionId, resourceGroup().id, environmentName)
var allTags = union({
  'azd-env-name': environmentName
  project: 'regista'
  workload: 'inside-the-game-hackathon'
}, tags)

var names = {
  identity: dashed('id', environmentName, tok)
  logAnalytics: dashed('log', environmentName, tok)
  appInsights: dashed('appi', environmentName, tok)
  registry: compact('cr', environmentName, tok)
  aiAccount: dashed('ai', environmentName, tok)
  aiProject: '${environmentName}-project'
  eventHubs: dashed('evh', environmentName, tok)
  cosmos: dashed('cosmos', environmentName, tok)
  storage: compact('st', environmentName, tok)
  containerEnv: dashed('cae', environmentName, tok)
  apiApp: '${environmentName}-api'
  staticWebApp: dashed('swa', environmentName, tok)
  webPubSub: dashed('wps', environmentName, tok)
  feederJob: '${environmentName}-feeder'
  functionsPlan: dashed('plan', environmentName, tok)
  functionsApp: dashed('func', environmentName, tok)
  fabricCapacity: compact('fab', environmentName, tok)
}

var functionsDeploymentContainer = 'func-deploy'

// ---------------------------------------------------------------------------------------------
// Identity + observability
// ---------------------------------------------------------------------------------------------

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: names.identity
  location: location
  tags: allTags
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    tags: allTags
    logAnalyticsName: names.logAnalytics
    appInsightsName: names.appInsights
    publisherPrincipalId: identity.properties.principalId
    dailyQuotaGb: logDailyCapGb
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    tags: allTags
    name: names.registry
    pullPrincipalId: identity.properties.principalId
  }
}

// ---------------------------------------------------------------------------------------------
// AI: Microsoft Foundry (models, agents, evaluations) + Speech, Translator, Content Safety
// ---------------------------------------------------------------------------------------------

module foundry 'modules/foundry.bicep' = {
  name: 'foundry'
  params: {
    location: location
    tags: allTags
    accountName: names.aiAccount
    projectName: names.aiProject
    chatModel: chatModel
    reasoningModel: reasoningModel
    modelSku: modelSku
    chatCapacity: chatCapacity
    reasoningCapacity: reasoningCapacity
    workloadPrincipalId: identity.properties.principalId
    deployerPrincipalId: deployerPrincipalId
    deployerPrincipalType: deployerPrincipalType
  }
}

// ---------------------------------------------------------------------------------------------
// Data: Event Hubs (live), Cosmos DB (operational), Storage (datasets/audio/recaps)
// ---------------------------------------------------------------------------------------------

module eventHubs 'modules/eventhubs.bicep' = {
  name: 'eventhubs'
  params: {
    location: location
    tags: allTags
    namespaceName: names.eventHubs
    workloadPrincipalId: identity.properties.principalId
    deployerPrincipalId: deployerPrincipalId
    deployerPrincipalType: deployerPrincipalType
  }
}

module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  params: {
    location: location
    tags: allTags
    accountName: names.cosmos
    workloadPrincipalId: identity.properties.principalId
    deployerPrincipalId: deployerPrincipalId
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    tags: allTags
    name: names.storage
    functionsDeploymentContainer: functionsDeploymentContainer
    workloadPrincipalId: identity.properties.principalId
    deployerPrincipalId: deployerPrincipalId
    deployerPrincipalType: deployerPrincipalType
  }
}

// ---------------------------------------------------------------------------------------------
// Compute: Container Apps (api, web, feeder job) + Functions (recap automation)
// ---------------------------------------------------------------------------------------------

var apiEnv = [
  { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
  { name: 'AZURE_OPENAI_ENDPOINT', value: foundry.outputs.openAiEndpoint }
  { name: 'AZURE_OPENAI_CHAT_DEPLOYMENT', value: foundry.outputs.chatDeploymentName }
  { name: 'AZURE_OPENAI_REASONING_DEPLOYMENT', value: foundry.outputs.reasoningDeploymentName }
  { name: 'FOUNDRY_PROJECT_ENDPOINT', value: foundry.outputs.projectEndpoint }
  { name: 'AZURE_AI_SERVICES_ENDPOINT', value: foundry.outputs.aiServicesEndpoint }
  { name: 'AZURE_AI_SERVICES_REGION', value: location }
  { name: 'AZURE_AI_SERVICES_RESOURCE_ID', value: foundry.outputs.accountId }
  { name: 'COSMOS_ENDPOINT', value: cosmos.outputs.endpoint }
  { name: 'COSMOS_DATABASE', value: cosmos.outputs.databaseName }
  { name: 'STORAGE_ACCOUNT_URL', value: storage.outputs.blobEndpoint }
  { name: 'EVENTHUB_FQDN', value: eventHubs.outputs.fullyQualifiedNamespace }
  { name: 'EVENTHUB_NAME', value: eventHubs.outputs.hubName }
  { name: 'EVENTHUB_CONSUMER_GROUP', value: 'api' }
  { name: 'LIVE_SOURCE', value: liveSource }
  { name: 'ONELAKE_WORKSPACE', value: oneLakeWorkspace }
  { name: 'ONELAKE_LAKEHOUSE', value: oneLakeLakehouse }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: monitoring.outputs.appInsightsConnectionString }
  { name: 'OTEL_SERVICE_NAME', value: 'regista-api' }
  { name: 'WEBPUBSUB_ENDPOINT', value: webPubSub.outputs.endpoint }
  { name: 'WEBPUBSUB_HUB', value: webPubSub.outputs.hubName }
  ...apiServiceEnv(parseApiServiceSettings(apiServiceSettings))   // REST paths, API versions, limits and timeouts (one definition for every profile)
]

module webPubSub 'modules/webpubsub.bicep' = {
  name: 'webpubsub'
  params: {
    location: location
    tags: allTags
    name: names.webPubSub
    sku: webPubSubSku
    units: webPubSubUnits
    publisherPrincipalId: identity.properties.principalId
    logAnalyticsId: resourceId('Microsoft.OperationalInsights/workspaces', monitoring.outputs.logAnalyticsName)
  }
}

module staticWebApp 'modules/staticwebapp.bicep' = {
  name: 'staticwebapp'
  params: {
    tags: allTags
    name: names.staticWebApp
    location: staticWebAppLocation
    sku: staticWebAppSku
  }
}

module containerApps 'modules/containerapps.bicep' = {
  name: 'containerapps'
  params: {
    location: location
    tags: allTags
    environmentName: names.containerEnv
    apiAppName: names.apiApp
    feederJobName: names.feederJob
    logAnalyticsName: monitoring.outputs.logAnalyticsName
    identityId: identity.id
    registryLoginServer: registry.outputs.loginServer
    apiImage: apiImage
    placeholderImage: placeholderImage
    apiEnv: apiEnv
    corsOrigins: staticWebApp.outputs.url
    apiMinReplicas: apiMinReplicas
  }
}

module functions 'modules/functions.bicep' = if (deployFunctions) {
  name: 'functions'
  params: {
    location: location
    tags: allTags
    planName: names.functionsPlan
    appName: names.functionsApp
    identityId: identity.id
    identityClientId: identity.properties.clientId
    storageAccountName: storage.outputs.name
    storageBlobEndpoint: storage.outputs.blobEndpoint
    deploymentContainer: functionsDeploymentContainer
    eventHubFqdn: eventHubs.outputs.fullyQualifiedNamespace
    eventHubName: eventHubs.outputs.hubName
    cosmosEndpoint: cosmos.outputs.endpoint
    cosmosDatabase: cosmos.outputs.databaseName
    apiUrl: containerApps.outputs.apiUrl
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
  }
}

// ---------------------------------------------------------------------------------------------
// Analytics: optional Fabric capacity (Lakehouse + Eventhouse are created by scripts/fabric-setup.py)
// ---------------------------------------------------------------------------------------------

module budget 'modules/budget.bicep' = if (!empty(budgetContactEmail)) {
  name: 'budget'
  params: {
    name: 'budget-${environmentName}'
    amount: budgetAmount
    contactEmails: [
      budgetContactEmail
    ]
    startDate: budgetStartDate
  }
}

module fabric 'modules/fabric.bicep' = if (deployFabricCapacity) {
  name: 'fabric'
  params: {
    location: location
    tags: allTags
    name: names.fabricCapacity
    adminMembers: [
      fabricAdminEmail
    ]
  }
}

// ---------------------------------------------------------------------------------------------
// Outputs (consumed by the GitHub workflows and docs/DEPLOYMENT.md)
// ---------------------------------------------------------------------------------------------

output AZURE_LOCATION string = location
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output AZURE_CONTAINER_ENVIRONMENT_NAME string = containerApps.outputs.environmentName
output DEPLOYMENT_PROFILE string = 'containerapps'
output AZURE_CLIENT_ID string = identity.properties.clientId
output IDENTITY_NAME string = identity.name
output ACR_NAME string = registry.outputs.name
output ACR_LOGIN_SERVER string = registry.outputs.loginServer
output CONTAINER_ENV_NAME string = containerApps.outputs.environmentName
output API_APP_NAME string = containerApps.outputs.apiAppName
output STATIC_WEB_APP_NAME string = staticWebApp.outputs.name
output WEBPUBSUB_ENDPOINT string = webPubSub.outputs.endpoint
output WEBPUBSUB_HUB string = webPubSub.outputs.hubName
output FEEDER_JOB_NAME string = containerApps.outputs.feederJobName
output API_URL string = containerApps.outputs.apiUrl
output WEB_URL string = staticWebApp.outputs.url
output MCP_URL string = '${containerApps.outputs.apiUrl}/mcp'
output FUNCTION_APP_NAME string = deployFunctions ? names.functionsApp : ''
output AI_ACCOUNT_NAME string = foundry.outputs.accountName
output AZURE_OPENAI_ENDPOINT string = foundry.outputs.openAiEndpoint
output FOUNDRY_PROJECT_ENDPOINT string = foundry.outputs.projectEndpoint
output AZURE_AI_SERVICES_ENDPOINT string = foundry.outputs.aiServicesEndpoint
output AZURE_AI_SERVICES_RESOURCE_ID string = foundry.outputs.accountId
output COSMOS_ENDPOINT string = cosmos.outputs.endpoint
output STORAGE_ACCOUNT_URL string = storage.outputs.blobEndpoint
output EVENTHUB_FQDN string = eventHubs.outputs.fullyQualifiedNamespace
output EVENTHUB_NAME string = eventHubs.outputs.hubName
output APPLICATIONINSIGHTS_NAME string = monitoring.outputs.appInsightsName
output FABRIC_CAPACITY_NAME string = deployFabricCapacity ? names.fabricCapacity : ''
