// Event Hubs: the live match-event backbone. One hub, one consumer group per downstream reader.

param location string
param tags object
param namespaceName string
param hubName string = 'match-events'

@allowed([
  'Enabled'
  'Disabled'
])
@description('Disabled in the enterprise profile, where the service is reached only through its private endpoint.')
param publicNetworkAccess string = 'Enabled'
param consumerGroups array = [
  'api'
  'functions'
  'fabric'
]

@description('Workload identity principal id (sends from the feeder, receives in the API and Function).')
param workloadPrincipalId string

param deployerPrincipalId string = ''

@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param deployerPrincipalType string = 'User'

var dataSenderRoleId = '2b629674-e913-4c01-ae53-ef4638d8f975'
var dataReceiverRoleId = 'a638d3c7-ab3a-418d-83e6-5f17a39d4fde'
var roleIds = [
  dataSenderRoleId
  dataReceiverRoleId
]

resource namespace 'Microsoft.EventHub/namespaces@2024-01-01' = {
  name: namespaceName
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
    capacity: 1
  }
  properties: {
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
    publicNetworkAccess: publicNetworkAccess
    isAutoInflateEnabled: false
  }
}

resource hub 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' = {
  parent: namespace
  name: hubName
  properties: {
    partitionCount: 4
    messageRetentionInDays: 1
  }
}

resource groups 'Microsoft.EventHub/namespaces/eventhubs/consumergroups@2024-01-01' = [
  for group in consumerGroups: {
    parent: hub
    name: group
    properties: {}
  }
]

resource workloadRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for roleId in roleIds: {
    name: guid(namespace.id, workloadPrincipalId, roleId)
    scope: namespace
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
      principalId: workloadPrincipalId
      principalType: 'ServicePrincipal'
    }
  }
]

resource deployerRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for roleId in roleIds: if (!empty(deployerPrincipalId)) {
    name: guid(namespace.id, deployerPrincipalId, roleId)
    scope: namespace
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
      principalId: deployerPrincipalId
      principalType: deployerPrincipalType
    }
  }
]

output id string = namespace.id
output namespaceName string = namespace.name
output fullyQualifiedNamespace string = '${namespace.name}.servicebus.windows.net'
output hubName string = hub.name
