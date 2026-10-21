using 'main.bicep'

// Values here are safe defaults for the hackathon. The GitHub workflows override
// deployerPrincipalId and apiImage on the command line.

param environmentName = readEnvironmentVariable('AZURE_ENV_NAME', 'regista')
param location = readEnvironmentVariable('AZURE_LOCATION', 'uksouth')
param deployerPrincipalId = readEnvironmentVariable('DEPLOYER_PRINCIPAL_ID', readEnvironmentVariable('AZURE_PRINCIPAL_ID', ''))
param deployerPrincipalType = readEnvironmentVariable('DEPLOYER_PRINCIPAL_TYPE', 'User')

// azd sets SERVICE_API_IMAGE_NAME after the first deploy, so re-provisioning keeps the running image
// (the GitHub workflows pass apiImage explicitly instead). The web app is on Static Web Apps (no image).
param apiImage = readEnvironmentVariable('SERVICE_API_IMAGE_NAME', 'mcr.microsoft.com/k8se/quickstart:latest')

param chatModel = {
  name: 'gpt-5.4-mini'
  version: '2026-03-17'
}
param reasoningModel = {
  name: 'gpt-5.5'
  version: '2026-04-24'
}
param modelSku = 'GlobalStandard'
param chatCapacity = 100
param reasoningCapacity = 50

param liveSource = 'replay'
param deployFunctions = true

// Fabric: prefer a free Fabric trial capacity. Set to true only if you need a paid F2.
param deployFabricCapacity = false
param fabricAdminEmail = readEnvironmentVariable('FABRIC_ADMIN_EMAIL', '')

// Cost guardrail: a monthly budget with e-mail alerts at 50% / 90% actual and 100% forecast.
// Fixed start month so redeploys during judging (October-November 2026) never try to move the period.
param budgetContactEmail = readEnvironmentVariable('BUDGET_EMAIL', '')
param budgetAmount = int(readEnvironmentVariable('BUDGET_AMOUNT', '150'))
param budgetStartDate = '2026-10-01'
