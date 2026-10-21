// The Regista API surface in API Management: one pass-through API at the root that forwards every method
// and path to the private NGINX ingress, with enterprise policy in front of it:
//   - a per-client-IP rate limit
//   - unbuffered responses so live server-sent events (/api/matches/{id}/live, the overlay) stream
//   - the gateway's own TLS (*.azure-api.net); plain HTTP inside the VNet to the ingress

param apimName string

@description('Private IP of the internal NGINX ingress in snet-ingress.')
param ingressPrivateIp string

param callsPerMinute int = 600

resource apim 'Microsoft.ApiManagement/service@2024-05-01' existing = {
  name: apimName
}

resource api 'Microsoft.ApiManagement/service/apis@2024-05-01' = {
  parent: apim
  name: 'regista'
  properties: {
    displayName: 'Regista'
    description: 'Regista web app, REST API, live SSE streams and MCP server, served from the private AKS ingress.'
    path: ''
    protocols: [
      'https'
    ]
    serviceUrl: 'http://${ingressPrivateIp}'
    subscriptionRequired: false
  }
}

var methods = [
  'GET'
  'POST'
  'PUT'
  'PATCH'
  'DELETE'
  'OPTIONS'
  'HEAD'
]

resource operations 'Microsoft.ApiManagement/service/apis/operations@2024-05-01' = [
  for m in methods: {
    parent: api
    name: 'all-${toLower(m)}'
    properties: {
      displayName: '${m} /*'
      method: m
      urlTemplate: '/*'
    }
  }
]

// Multi-line Bicep strings don't interpolate, so the limit is substituted with replace().
var policyXml = '''
<policies>
  <inbound>
    <base />
    <rate-limit-by-key calls="__CALLS__" renewal-period="60" counter-key="@(context.Request.IpAddress)" />
  </inbound>
  <backend>
    <forward-request timeout="240" buffer-response="false" />
  </backend>
  <outbound>
    <base />
  </outbound>
  <on-error>
    <base />
  </on-error>
</policies>
'''

resource policy 'Microsoft.ApiManagement/service/apis/policies@2024-05-01' = {
  parent: api
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: replace(policyXml, '__CALLS__', string(callsPerMinute))
  }
}
