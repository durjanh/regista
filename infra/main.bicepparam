using 'main.bicep'

// Values here are safe defaults for the hackathon. The GitHub workflows override
// deployerPrincipalId and apiImage on the command line.

param environmentName = readEnvironmentVariable('AZURE_ENV_NAME', 'regista')
param location = readEnvironmentVariable('AZURE_LOCATION', 'uksouth')
param deployerPrincipalId = readEnvironmentVariable('DEPLOYER_PRINCIPAL_ID', readEnvironmentVariable('AZURE_PRINCIPAL_ID', ''))
// azd sets AZURE_PRINCIPAL_TYPE (ServicePrincipal in pipelines); a wrong type makes role assignments fail (UnmatchedPrincipalType).
param deployerPrincipalType = readEnvironmentVariable('DEPLOYER_PRINCIPAL_TYPE', readEnvironmentVariable('AZURE_PRINCIPAL_TYPE', 'User'))

// azd sets SERVICE_API_IMAGE_NAME after the first deploy, so re-provisioning keeps the running image
// (the GitHub workflows pass apiImage explicitly instead). The web app is on Static Web Apps (no image).
param apiImage = readEnvironmentVariable('SERVICE_API_IMAGE_NAME', 'mcr.microsoft.com/k8se/quickstart:latest')

// Models come from the azd environment so a subscription without quota for the defaults can use what it has
// (e.g. CHAT_MODEL_NAME=gpt-5-mini CHAT_MODEL_VERSION=2025-08-07). Check: az cognitiveservices usage list -l uksouth
param chatModel = {
  name: readEnvironmentVariable('CHAT_MODEL_NAME', 'gpt-5.4-mini')
  version: readEnvironmentVariable('CHAT_MODEL_VERSION', '2026-03-17')
}
param reasoningModel = {
  name: readEnvironmentVariable('REASONING_MODEL_NAME', 'gpt-5.5')
  version: readEnvironmentVariable('REASONING_MODEL_VERSION', '2026-04-24')
}
param modelSku = readEnvironmentVariable('MODEL_SKU', 'GlobalStandard')
param chatCapacity = 100
param reasoningCapacity = 50

param liveSource = 'replay'

// Set by deploy/hooks/fabric.sh after the Fabric setup; empty = no OneLake export.
param oneLakeWorkspace = readEnvironmentVariable('ONELAKE_WORKSPACE', '')
param oneLakeLakehouse = readEnvironmentVariable('ONELAKE_LAKEHOUSE', '')
param deployFunctions = true

// Fabric: prefer a free Fabric trial capacity. Set to true only if you need a paid F2.
param deployFabricCapacity = false
param fabricAdminEmail = readEnvironmentVariable('FABRIC_ADMIN_EMAIL', '')

// Cost guardrail: a monthly budget with e-mail alerts at 50% / 90% actual and 100% forecast.
// Fixed start month so redeploys during October-November 2026 never try to move the period.
param budgetContactEmail = readEnvironmentVariable('BUDGET_EMAIL', '')
param budgetAmount = int(readEnvironmentVariable('BUDGET_AMOUNT', '150'))
param budgetStartDate = '2026-10-01'

// Static Web Apps isn't in UK South, and new subscriptions may be refused in some of its regions (West Europe was).
param staticWebAppLocation = readEnvironmentVariable('STATIC_WEB_APP_LOCATION', 'eastus2')
param staticWebAppSku = readEnvironmentVariable('STATIC_WEB_APP_SKU', 'Free')   // Free tier unless overridden

// Pay only when used: the API scales to zero by default. `azd env set API_MIN_REPLICAS 1` keeps one warm (public demo, recordings).
param apiMinReplicas = int(readEnvironmentVariable('API_MIN_REPLICAS', '0'))
param logDailyCapGb = int(readEnvironmentVariable('LOG_DAILY_CAP_GB', '1'))
// The API's service-contract settings: defaults in modules/api-settings.bicep, overrides as KEY=value;KEY=value.
param apiServiceSettings = readEnvironmentVariable('API_SERVICE_SETTINGS', '')

// Shared live broadcast: 1 Standard unit = 1,000 concurrent viewers (~$49/month, estimate). WEBPUBSUB_UNITS=100 = 100,000.
param webPubSubSku = readEnvironmentVariable('WEBPUBSUB_SKU', 'Standard_S1')
param webPubSubUnits = int(readEnvironmentVariable('WEBPUBSUB_UNITS', '1'))
