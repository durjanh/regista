// Azure Container Registry with admin user disabled. Workloads pull with their managed identity.

param location string
param tags object
param name string

@allowed([
  'Basic'
  'Standard'
  'Premium'
])
@description('Premium is required for private endpoints (enterprise profile).')
param sku string = 'Basic'

@allowed([
  'Enabled'
  'Disabled'
])
@description('Disabled in the enterprise profile, where the service is reached only through its private endpoint.')
param publicNetworkAccess string = 'Enabled'

@description('Principal granted AcrPull (the workload identity).')
param pullPrincipalId string

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku
  }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    publicNetworkAccess: publicNetworkAccess
    networkRuleBypassOptions: 'AzureServices'
  }
}

resource pullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, pullPrincipalId, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: pullPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output name string = registry.name
output id string = registry.id
output loginServer string = registry.properties.loginServer
output pullRoleAssignmentId string = pullRole.id
