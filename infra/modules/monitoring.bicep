// Log Analytics + workspace-based Application Insights.

param location string
param tags object
param logAnalyticsName string
param appInsightsName string

@description('Principal that publishes telemetry with Entra ID (the workload identity).')
param publisherPrincipalId string

@description('Daily ingestion cap in GB (cost guardrail). -1 = no cap.')
param dailyQuotaGb int = 1

var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: dailyQuotaGb
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    // The API's OpenTelemetry exporter uses the connection string. The Function App
    // authenticates with Entra ID via APPLICATIONINSIGHTS_AUTHENTICATION_STRING.
    DisableLocalAuth: false
  }
}

resource publisherRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appInsights.id, publisherPrincipalId, monitoringMetricsPublisherRoleId)
  scope: appInsights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherRoleId)
    principalId: publisherPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output logAnalyticsName string = logAnalytics.name
output logAnalyticsCustomerId string = logAnalytics.properties.customerId
output appInsightsName string = appInsights.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
