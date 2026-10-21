// Microsoft Foundry: one AIServices account (models + Speech + Translator + Content Safety),
// a Foundry project for agents/evaluations/tracing, and two model deployments.
// Keyless: local (key) auth is disabled; every caller uses Entra ID.

param location string
param tags object
param accountName string
param projectName string

@allowed([
  'Enabled'
  'Disabled'
])
@description('Disabled in the enterprise profile, where the service is reached only through its private endpoint.')
param publicNetworkAccess string = 'Enabled'

@description('Fast model used for live narration, translation and fact-check passes.')
param chatModel object

@description('Stronger model used for recaps, the analyst agent and Scenario Director.')
param reasoningModel object

@description('Deployment SKU, e.g. GlobalStandard.')
param modelSku string

@description('Capacity (thousands of tokens per minute) for the chat deployment.')
param chatCapacity int

@description('Capacity (thousands of tokens per minute) for the reasoning deployment.')
param reasoningCapacity int

@description('Workload identity principal id.')
param workloadPrincipalId string

@description('Optional deployer principal id (user or service principal) for local development.')
param deployerPrincipalId string = ''

@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param deployerPrincipalType string = 'User'

// Verified on Microsoft Learn (Azure built-in roles / Foundry RBAC):
var cognitiveServicesOpenAIUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var foundryUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d' // formerly "Azure AI User"

var roleIds = [
  cognitiveServicesOpenAIUserRoleId
  cognitiveServicesUserRoleId
  foundryUserRoleId
]

resource account 'Microsoft.CognitiveServices/accounts@2026-03-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    // Required for Foundry projects.
    allowProjectManagement: true
    // Required for Entra ID token auth (Speech, Translator, OpenAI).
    customSubDomainName: accountName
    disableLocalAuth: true
    publicNetworkAccess: publicNetworkAccess
    networkAcls: {
      defaultAction: publicNetworkAccess == 'Enabled' ? 'Allow' : 'Deny'
      bypass: 'AzureServices'
    }
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2026-03-01' = {
  parent: account
  name: projectName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: 'Regista match intelligence'
    description: 'Agents, evaluations and tracing for the Regista football intelligence platform.'
  }
}

// Deployments on the same account must be created one at a time, hence the explicit dependsOn.
resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2026-03-01' = {
  parent: account
  name: 'chat'
  sku: {
    name: modelSku
    capacity: chatCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: chatModel.name
      version: chatModel.version
    }
    raiPolicyName: 'Microsoft.DefaultV2'
  }
  dependsOn: [
    project
  ]
}

resource reasoningDeployment 'Microsoft.CognitiveServices/accounts/deployments@2026-03-01' = {
  parent: account
  name: 'reasoning'
  sku: {
    name: modelSku
    capacity: reasoningCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: reasoningModel.name
      version: reasoningModel.version
    }
    raiPolicyName: 'Microsoft.DefaultV2'
  }
  dependsOn: [
    chatDeployment
  ]
}

resource workloadRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for roleId in roleIds: {
    name: guid(account.id, workloadPrincipalId, roleId)
    scope: account
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
      principalId: workloadPrincipalId
      principalType: 'ServicePrincipal'
    }
  }
]

resource deployerRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for roleId in roleIds: if (!empty(deployerPrincipalId)) {
    name: guid(account.id, deployerPrincipalId, roleId)
    scope: account
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
      principalId: deployerPrincipalId
      principalType: deployerPrincipalType
    }
  }
]

output accountName string = account.name
output accountId string = account.id
output projectName string = project.name
output openAiEndpoint string = 'https://${accountName}.openai.azure.com'
output aiServicesEndpoint string = 'https://${accountName}.cognitiveservices.azure.com/'
output projectEndpoint string = 'https://${accountName}.services.ai.azure.com/api/projects/${projectName}'
output chatDeploymentName string = chatDeployment.name
output reasoningDeploymentName string = reasoningDeployment.name
