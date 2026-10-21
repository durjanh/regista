// Azure Functions (Flex Consumption, Python): on every `full_time` event in Event Hubs, generate the
// broadcaster recap through the API and persist it to Cosmos DB and Blob Storage.
// Everything is identity-based: host storage, Event Hubs trigger, Cosmos, Blob and App Insights.

param location string
param tags object
param planName string
param appName string

param identityId string
param identityClientId string

param storageAccountName string
param storageBlobEndpoint string
param deploymentContainer string

param eventHubFqdn string
param eventHubName string
param eventHubConsumerGroup string = 'functions'

param cosmosEndpoint string
param cosmosDatabase string
param apiUrl string
param appInsightsConnectionString string

@allowed([
  2048
  4096
])
param instanceMemoryMB int = 2048

@minValue(40)
@maxValue(1000)
param maximumInstanceCount int = 40

param pythonVersion string = '3.12'

@description('Subnet (delegated to Microsoft.App/environments) for outbound VNet integration, so the app reaches private endpoints. Empty = no integration.')
param subnetId string = ''

resource plan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: planName
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-11-01' = {
  name: appName
  location: location
  tags: union(tags, { 'azd-service-name': 'functions' })
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    virtualNetworkSubnetId: empty(subnetId) ? null : subnetId
    siteConfig: {
      minTlsVersion: '1.2'
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageBlobEndpoint}${deploymentContainer}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: identityId
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: maximumInstanceCount
        instanceMemoryMB: instanceMemoryMB
      }
      runtime: {
        name: 'python'
        version: pythonVersion
      }
    }
  }

  resource appSettings 'config' = {
    name: 'appsettings'
    properties: {
      AzureWebJobsStorage__accountName: storageAccountName
      AzureWebJobsStorage__credential: 'managedidentity'
      AzureWebJobsStorage__clientId: identityClientId
      EventHubConnection__fullyQualifiedNamespace: eventHubFqdn
      EventHubConnection__credential: 'managedidentity'
      EventHubConnection__clientId: identityClientId
      EVENTHUB_NAME: eventHubName
      EVENTHUB_CONSUMER_GROUP: eventHubConsumerGroup
      AZURE_CLIENT_ID: identityClientId
      REGISTA_API_URL: apiUrl
      COSMOS_ENDPOINT: cosmosEndpoint
      COSMOS_DATABASE: cosmosDatabase
      STORAGE_ACCOUNT_URL: storageBlobEndpoint
      APPLICATIONINSIGHTS_CONNECTION_STRING: appInsightsConnectionString
      APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'ClientId=${identityClientId};Authorization=AAD'
    }
  }
}

output name string = functionApp.name
output defaultHostName string = functionApp.properties.defaultHostName
