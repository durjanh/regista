// Azure Web PubSub: fan-out for the shared live broadcast. The API publishes once per tick to a group per match;
// Web PubSub delivers it to every viewer. 1,000 concurrent connections per unit, up to 100 units (100,000 viewers)
// per resource on Standard_S1 / Premium_P1; Premium_P2 goes to 1,000,000 (Microsoft Learn: billing model, scaling).
// Keyless: local (access-key) auth is disabled; the API issues client tokens with Microsoft Entra ID.

param location string
param tags object
param name string
param hubName string = 'regista'

@allowed([
  'Free_F1'
  'Standard_S1'
  'Premium_P1'
])
@description('Free_F1 is for development only (20 connections). Standard_S1: 1,000 connections per unit.')
param sku string = 'Standard_S1'

@allowed([
  1
  2
  3
  4
  5
  6
  7
  8
  9
  10
  20
  30
  40
  50
  60
  70
  80
  90
  100
])
@description('Units (1,000 concurrent connections each on Standard/Premium). 100 = 100,000 viewers. Billed per unit-day.')
param units int = 1

@description('Principal that publishes and issues client tokens (the workload identity).')
param publisherPrincipalId string

@description('Enterprise: only browser (client) connections are allowed from the public internet; the API reaches the REST endpoint through a private endpoint.')
param privateServerTraffic bool = false

param logAnalyticsId string

// Verified with az role definition list (built-in role): includes clientConnection/generateToken and /write.
var webPubSubServiceOwnerRoleId = '12cf5a90-567b-43ae-8102-96cf46c7d9b4'

resource webPubSub 'Microsoft.SignalRService/webPubSub@2024-03-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku
    tier: split(sku, '_')[0]
    capacity: sku == 'Free_F1' ? 1 : units
  }
  properties: {
    disableLocalAuth: true
    disableAadAuth: false
    publicNetworkAccess: 'Enabled'
    tls: {
      clientCertEnabled: false
    }
    // Enterprise: the public side denies server, REST and trace traffic, so browsers' client connections are the only
    // public use; private endpoints keep the default (allow), so the API publishes through its private endpoint.
    networkACLs: privateServerTraffic
      ? {
          defaultAction: 'Allow'
          publicNetwork: {
            deny: [
              'ServerConnection'
              'RESTAPI'
              'Trace'
            ]
          }
        }
      : {
          defaultAction: 'Allow'
        }
  }
}

resource hub 'Microsoft.SignalRService/webPubSub/hubs@2024-03-01' = {
  parent: webPubSub
  name: hubName
  properties: {
    anonymousConnectPolicy: 'deny'
  }
}

resource ownerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(webPubSub.id, publisherPrincipalId, webPubSubServiceOwnerRoleId)
  scope: webPubSub
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', webPubSubServiceOwnerRoleId)
    principalId: publisherPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: webPubSub
  properties: {
    workspaceId: logAnalyticsId
    logs: [
      { categoryGroup: 'allLogs', enabled: true }
    ]
    metrics: [
      { category: 'AllMetrics', enabled: true }
    ]
  }
}

output id string = webPubSub.id
output name string = webPubSub.name
output endpoint string = 'https://${webPubSub.properties.hostName}'
output hubName string = hub.name
