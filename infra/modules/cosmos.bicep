// Cosmos DB for NoSQL (serverless): narratives, studio items, recaps, match metadata, fan profiles.
// Local (key) auth disabled; data-plane access through Cosmos DB native RBAC.

param location string
param tags object
param accountName string
param databaseName string = 'regista'

@allowed([
  'Enabled'
  'Disabled'
])
@description('Disabled in the enterprise profile, where the service is reached only through its private endpoint.')
param publicNetworkAccess string = 'Enabled'

param workloadPrincipalId string
param deployerPrincipalId string = ''

var matchContainers = [
  'matches'
  'narratives'
  'studio'
  'recaps'
]

// Cosmos DB Built-in Data Contributor (data-plane role, not an Azure RBAC role).
var dataContributorRoleDefinitionId = '00000000-0000-0000-0000-000000000002'

var principals = empty(deployerPrincipalId) ? [workloadPrincipalId] : [workloadPrincipalId, deployerPrincipalId]

resource account 'Microsoft.DocumentDB/databaseAccounts@2025-04-15' = {
  name: accountName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: true
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: publicNetworkAccess
    // Azure turns this on for new accounts; declaring it keeps re-runs from flipping it (single region: no effect).
    enableAutomaticFailover: true
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2025-04-15' = {
  parent: account
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource containers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2025-04-15' = [
  for name in matchContainers: {
    parent: database
    name: name
    properties: {
      resource: {
        id: name
        partitionKey: {
          paths: [
            '/match_id'
          ]
          kind: 'Hash'
        }
      }
    }
  }
]

resource profiles 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2025-04-15' = {
  parent: database
  name: 'profiles'
  properties: {
    resource: {
      id: 'profiles'
      partitionKey: {
        paths: [
          '/user_id'
        ]
        kind: 'Hash'
      }
    }
  }
}

resource dataRoles 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2025-04-15' = [
  for principalId in principals: {
    parent: account
    name: guid(account.id, principalId, dataContributorRoleDefinitionId)
    properties: {
      roleDefinitionId: '${account.id}/sqlRoleDefinitions/${dataContributorRoleDefinitionId}'
      principalId: principalId
      scope: account.id
    }
  }
]

output id string = account.id
output accountName string = account.name
output endpoint string = account.properties.documentEndpoint
output databaseName string = database.name
