// Azure Static Web Apps: hosts the React SPA (and the broadcast overlay page) on a global edge with free managed TLS.
// The SPA calls the API directly at its public URL (fetch + server-sent events); the API's CORS allows only this
// site's origin. No linked backend: that needs the Standard plan, can't link AKS, and would put a proxy in front of
// the live SSE streams. Content is uploaded by azd (or the SWA CLI) with the deployment token, so no repo link here.
// Static Web Apps isn't offered in every region (not UK South): `location` holds the resource's metadata only;
// the static files are served from the global edge.

param tags object
param name string

@allowed([
  'westeurope'
  'centralus'
  'eastus2'
  'westus2'
  'eastasia'
])
param location string = 'westeurope'

@allowed([
  'Free'
  'Standard'
])
@description('Free for demos; Standard adds the SLA, custom domains with private endpoints, and more bandwidth.')
param sku string = 'Free'

resource site 'Microsoft.Web/staticSites@2025-03-01' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  sku: {
    name: sku
    tier: sku
  }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Disabled'
  }
}

output name string = site.name
output url string = 'https://${site.properties.defaultHostname}'
