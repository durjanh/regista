// Storage account with shared-key access disabled. Holds generated datasets, TTS audio,
// recaps and the Function App deployment package.

param location string
param tags object
param name string
param functionsDeploymentContainer string

@allowed([
  'Enabled'
  'Disabled'
])
@description('Disabled in the enterprise profile, where the service is reached only through its private endpoint.')
param publicNetworkAccess string = 'Enabled'

param workloadPrincipalId string
param deployerPrincipalId string = ''

@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param deployerPrincipalType string = 'User'

var blobContainers = [
  'datasets'
  'audio'
  'recaps'
  functionsDeploymentContainer
]

// Verified on Microsoft Learn (Azure built-in roles, Storage section).
var storageBlobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var storageQueueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'

// The Functions host needs blob owner + queue + table on its AzureWebJobsStorage account.
var workloadRoleIds = [
  storageBlobDataOwnerRoleId
  storageQueueDataContributorRoleId
  storageTableDataContributorRoleId
]

resource storage 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: publicNetworkAccess
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: publicNetworkAccess == 'Enabled' ? 'Allow' : 'Deny'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: storage
  name: 'default'
}

resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = [
  for container in blobContainers: {
    parent: blobService
    name: container
    properties: {
      publicAccess: 'None'
    }
  }
]

resource workloadRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for roleId in workloadRoleIds: {
    name: guid(storage.id, workloadPrincipalId, roleId)
    scope: storage
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
      principalId: workloadPrincipalId
      principalType: 'ServicePrincipal'
    }
  }
]

resource deployerBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(storage.id, deployerPrincipalId, storageBlobDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: deployerPrincipalId
    principalType: deployerPrincipalType
  }
}

output id string = storage.id
output name string = storage.name
output blobEndpoint string = storage.properties.primaryEndpoints.blob
