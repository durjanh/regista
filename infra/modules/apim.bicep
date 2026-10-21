// API Management Standard v2: the enterprise profile's only public endpoint.
//   inbound:  the public gateway (HTTPS on *.azure-api.net), with rate limits and policies per API
//   outbound: VNet integration into snet-apim, so the gateway reaches the private NGINX ingress; nothing behind it
//             (AKS, registry, data services) has a public endpoint
// Standard v2 is the cheaper of the two tiers (Standard v2, Premium v2) with outbound VNet integration. No WAF: add Front Door Premium or
// Application Gateway WAF in front of the gateway for production.

param location string
param tags object
param name string
param publisherEmail string
param publisherName string = 'Regista'

@allowed([
  'StandardV2'
  'PremiumV2'
])
param sku string = 'StandardV2'

param capacity int = 1

@description('Subnet delegated to Microsoft.Web/serverFarms for outbound VNet integration.')
param subnetId string

param logAnalyticsId string

resource apim 'Microsoft.ApiManagement/service@2024-05-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku
    capacity: capacity
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publisherEmail: publisherEmail
    publisherName: publisherName
    virtualNetworkType: 'External'
    virtualNetworkConfiguration: {
      subnetResourceId: subnetId
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: apim
  properties: {
    workspaceId: logAnalyticsId
    logAnalyticsDestinationType: 'Dedicated'
    logs: [
      { categoryGroup: 'allLogs', enabled: true }
    ]
    metrics: [
      { category: 'AllMetrics', enabled: true }
    ]
  }
}

output name string = apim.name
output id string = apim.id
output gatewayHost string = replace(apim.properties.gatewayUrl, 'https://', '')
