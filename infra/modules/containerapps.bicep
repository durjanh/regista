// Azure Container Apps: environment, the API (FastAPI + agents + MCP) and the live-feed job that streams a synthetic
// match into Event Hubs. The React front end is on Azure Static Web Apps (staticwebapp.bicep) and calls the API
// directly, so the API's CORS allows exactly that origin.

param location string
param tags object
param environmentName string
param apiAppName string
param feederJobName string

param logAnalyticsName string
param identityId string
param registryLoginServer string

param apiImage string
param placeholderImage string

@description('Environment variables for the API container and the feeder job (name/value pairs).')
param apiEnv array

@description('Origins allowed to call the API from a browser (the Static Web App URL), comma-separated.')
param corsOrigins string

@minValue(0)
param apiMinReplicas int = 1
param apiMaxReplicas int = 5

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2025-02-01' existing = {
  name: logAnalyticsName
}

// The placeholder image (first deploy, before anything is in ACR) listens on port 80 and has no
// health endpoints, so ports and probes switch over once the real images are rolled out.
var apiIsPlaceholder = apiImage == placeholderImage
var apiPort = apiIsPlaceholder ? 80 : 8000

var registries = [
  {
    server: registryLoginServer
    identity: identityId
  }
]

resource managedEnvironment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    zoneRedundant: false
  }
}

// Container App FQDNs are <app-name>.<environment default domain>, so the URLs are known before the
// apps exist. That lets the API know its own public URL (for MCP).
var apiUrl = 'https://${apiAppName}.${managedEnvironment.properties.defaultDomain}'

var apiEnvFull = concat(apiEnv, [
  {
    name: 'PUBLIC_BASE_URL'
    value: apiUrl
  }
  {
    name: 'CORS_ORIGINS'
    value: corsOrigins
  }
])

resource api 'Microsoft.App/containerApps@2025-07-01' = {
  name: apiAppName
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    environmentId: managedEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: apiPort
        transport: 'auto'
        allowInsecure: false
      }
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: apiEnvFull
          probes: apiIsPlaceholder
            ? []
            : [
                {
                  type: 'Liveness'
                  httpGet: {
                    path: '/api/health'
                    port: apiPort
                  }
                  initialDelaySeconds: 10
                  periodSeconds: 30
                }
                {
                  type: 'Readiness'
                  httpGet: {
                    path: '/api/health'
                    port: apiPort
                  }
                  initialDelaySeconds: 5
                  periodSeconds: 10
                }
              ]
        }
      ]
      scale: {
        minReplicas: apiMinReplicas
        maxReplicas: apiMaxReplicas
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

// Manually triggered job: replays a synthetic match into Event Hubs at real speed (or faster).
// Start it with: az containerapp job start -n <job> -g <rg> [--args "--match-id <id> --speed 30"]
resource feeder 'Microsoft.App/jobs@2025-07-01' = {
  name: feederJobName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    environmentId: managedEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 7200
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'feeder'
          image: apiImage
          command: apiIsPlaceholder
            ? []
            : [
                'python'
                '-m'
                'app.live.feeder'
              ]
          args: apiIsPlaceholder
            ? []
            : [
                '--speed'
                '1'
              ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: apiEnv
        }
      ]
    }
  }
}

output environmentName string = managedEnvironment.name
output defaultDomain string = managedEnvironment.properties.defaultDomain
output apiAppName string = api.name
output feederJobName string = feeder.name
output apiUrl string = apiUrl
