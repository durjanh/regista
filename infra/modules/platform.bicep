// Everything the Kubernetes profiles share with the Container Apps profile: identity, observability, registry,
// Microsoft Foundry (models + Speech/Translator/Content Safety), Event Hubs, Cosmos DB, Storage, budget and the
// optional Fabric capacity. The enterprise profile passes publicNetworkAccess = 'Disabled' and adds private endpoints.

param location string
param tags object
param environmentName string
param tok string

param deployerPrincipalId string = ''

@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param deployerPrincipalType string = 'User'

param chatModel object
param reasoningModel object
param modelSku string
param chatCapacity int
param reasoningCapacity int

@allowed([
  'Enabled'
  'Disabled'
])
param publicNetworkAccess string = 'Enabled'

@allowed([
  'Basic'
  'Standard'
  'Premium'
])
param registrySku string = 'Basic'

param budgetContactEmail string = ''
param budgetAmount int = 300
param budgetStartDate string
param deployFabricCapacity bool = false
param fabricAdminEmail string = ''

import { compact, dashed } from 'naming.bicep'

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
  fabricCapacity: compact('fab', environmentName, tok)
}

var functionsDeploymentContainer = 'func-deploy'

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: names.identity
  location: location
  tags: tags
}

module monitoring 'monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    tags: tags
    logAnalyticsName: names.logAnalytics
    appInsightsName: names.appInsights
    publisherPrincipalId: identity.properties.principalId
  }
}

module registry 'registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    tags: tags
    name: names.registry
    sku: registrySku
    publicNetworkAccess: publicNetworkAccess
    pullPrincipalId: identity.properties.principalId
  }
}

module foundry 'foundry.bicep' = {
  name: 'foundry'
  params: {
    location: location
    tags: tags
    accountName: names.aiAccount
    projectName: names.aiProject
    publicNetworkAccess: publicNetworkAccess
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

module eventHubs 'eventhubs.bicep' = {
  name: 'eventhubs'
  params: {
    location: location
    tags: tags
    namespaceName: names.eventHubs
    publicNetworkAccess: publicNetworkAccess
    workloadPrincipalId: identity.properties.principalId
    deployerPrincipalId: deployerPrincipalId
    deployerPrincipalType: deployerPrincipalType
  }
}

module cosmos 'cosmos.bicep' = {
  name: 'cosmos'
  params: {
    location: location
    tags: tags
    accountName: names.cosmos
    publicNetworkAccess: publicNetworkAccess
    workloadPrincipalId: identity.properties.principalId
    deployerPrincipalId: deployerPrincipalId
  }
}

module storage 'storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    tags: tags
    name: names.storage
    publicNetworkAccess: publicNetworkAccess
    functionsDeploymentContainer: functionsDeploymentContainer
    workloadPrincipalId: identity.properties.principalId
    deployerPrincipalId: deployerPrincipalId
    deployerPrincipalType: deployerPrincipalType
  }
}

module budget 'budget.bicep' = if (!empty(budgetContactEmail)) {
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

module fabric 'fabric.bicep' = if (deployFabricCapacity) {
  name: 'fabric'
  params: {
    location: location
    tags: tags
    name: names.fabricCapacity
    adminMembers: [
      fabricAdminEmail
    ]
  }
}

output identityName string = identity.name
output identityId string = identity.id
output identityClientId string = identity.properties.clientId
output identityPrincipalId string = identity.properties.principalId
output logAnalyticsId string = resourceId('Microsoft.OperationalInsights/workspaces', monitoring.outputs.logAnalyticsName)
output appInsightsName string = monitoring.outputs.appInsightsName
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
output registryName string = registry.outputs.name
output registryId string = registry.outputs.id
output registryLoginServer string = registry.outputs.loginServer
output aiAccountName string = foundry.outputs.accountName
output aiAccountId string = foundry.outputs.accountId
output openAiEndpoint string = foundry.outputs.openAiEndpoint
output aiServicesEndpoint string = foundry.outputs.aiServicesEndpoint
output projectEndpoint string = foundry.outputs.projectEndpoint
output chatDeploymentName string = foundry.outputs.chatDeploymentName
output reasoningDeploymentName string = foundry.outputs.reasoningDeploymentName
output eventHubsId string = eventHubs.outputs.id
output eventHubFqdn string = eventHubs.outputs.fullyQualifiedNamespace
output eventHubName string = eventHubs.outputs.hubName
output cosmosId string = cosmos.outputs.id
output cosmosEndpoint string = cosmos.outputs.endpoint
output cosmosDatabase string = cosmos.outputs.databaseName
output storageId string = storage.outputs.id
output storageName string = storage.outputs.name
output storageBlobEndpoint string = storage.outputs.blobEndpoint
output functionsDeploymentContainer string = functionsDeploymentContainer
output fabricCapacityName string = deployFabricCapacity ? names.fabricCapacity : ''
