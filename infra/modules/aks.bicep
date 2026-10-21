// AKS for both Kubernetes profiles. Keyless and Entra-only:
//   - local accounts disabled; Kubernetes RBAC through Azure RBAC (roles granted by the postprovision hook by name)
//   - workload identity: the API's service account federates to the shared user-assigned identity
//   - kubelet pulls from ACR with AcrPull; no image pull secrets
//   - Azure CNI overlay with Cilium (dataplane + network policy)
//   - application routing add-on (managed NGINX) for ingress
//   - Container Insights (Entra auth) and Azure Policy; automatic patch and node-image upgrades
// standard profile: public API server, optionally limited to authorizedIpRanges.
// enterprise profile: private API server (no public FQDN), nodes in the enterprise VNet.

param location string
param tags object
param clusterName string
param controlPlaneIdentityName string

@description('Workload (pod) identity name: the shared user-assigned identity the API uses for Azure.')
param workloadIdentityName string

param registryName string
param logAnalyticsId string

@allowed([
  'Free'
  'Standard'
])
@description('Free has no uptime SLA; Standard adds the financially backed SLA.')
param tier string = 'Free'

param nodeVmSize string = 'Standard_D4ds_v5'

@minValue(1)
param nodeMinCount int = 1

@minValue(1)
param nodeMaxCount int = 3

@description('Nodes subnet (enterprise). Empty = AKS-managed VNet (standard).')
param nodeSubnetId string = ''

@description('VNet name, so the control-plane identity can manage the internal load balancer in it (enterprise). Empty = none.')
param vnetName string = ''

param privateCluster bool = false

@description('Public API server only: CIDRs allowed to reach it. Empty = any (still Entra-authenticated).')
param authorizedIpRanges array = []

param enableAzurePolicy bool = false

@description('Kubernetes namespace and service account the API runs as (must match deploy/k8s).')
param apiNamespace string = 'regista'
param apiServiceAccount string = 'regista-api'

// Verified on Microsoft Learn (Azure built-in roles).
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var networkContributorRoleId = '4d97b98b-1d4f-4787-a291-c67834d212e7'

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = {
  name: registryName
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-07-01' existing = if (!empty(vnetName)) {
  name: vnetName
}

resource workloadIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: workloadIdentityName
}

resource controlPlaneIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: controlPlaneIdentityName
  location: location
  tags: tags
}

// The control plane creates the internal load balancer in the VNet, so it needs Network Contributor there
// before the cluster exists.
resource vnetRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(vnetName)) {
  name: guid(vnet.id, controlPlaneIdentity.id, networkContributorRoleId)
  scope: vnet
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', networkContributorRoleId)
    principalId: controlPlaneIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource cluster 'Microsoft.ContainerService/managedClusters@2026-06-01' = {
  name: clusterName
  location: location
  tags: tags
  sku: {
    name: 'Base'
    tier: tier
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${controlPlaneIdentity.id}': {}
    }
  }
  properties: {
    dnsPrefix: clusterName
    enableRBAC: true
    disableLocalAccounts: true
    aadProfile: {
      managed: true
      enableAzureRBAC: true
      tenantID: tenant().tenantId
    }
    oidcIssuerProfile: {
      enabled: true
    }
    securityProfile: {
      workloadIdentity: {
        enabled: true
      }
      imageCleaner: {
        enabled: true
        intervalHours: 168
      }
    }
    networkProfile: {
      networkPlugin: 'azure'
      networkPluginMode: 'overlay'
      networkDataplane: 'cilium'
      networkPolicy: 'cilium'
      podCidr: '192.168.0.0/16'
      serviceCidr: '172.16.0.0/16'
      dnsServiceIP: '172.16.0.10'
      outboundType: 'loadBalancer'
      loadBalancerSku: 'standard'
    }
    agentPoolProfiles: [
      {
        name: 'system'
        mode: 'System'
        osType: 'Linux'
        osSKU: 'AzureLinux'
        type: 'VirtualMachineScaleSets'
        vmSize: nodeVmSize
        count: nodeMinCount
        enableAutoScaling: true
        minCount: nodeMinCount
        maxCount: nodeMaxCount
        vnetSubnetID: empty(nodeSubnetId) ? null : nodeSubnetId
      }
    ]
    apiServerAccessProfile: privateCluster
      ? {
          enablePrivateCluster: true
          enablePrivateClusterPublicFQDN: false
          privateDNSZone: 'system'
        }
      : {
          authorizedIPRanges: authorizedIpRanges
        }
    ingressProfile: {
      webAppRouting: {
        enabled: true
      }
    }
    addonProfiles: {
      omsagent: {
        enabled: true
        config: {
          logAnalyticsWorkspaceResourceID: logAnalyticsId
          useAADAuth: 'true'
        }
      }
      azurepolicy: {
        enabled: enableAzurePolicy
      }
    }
    autoUpgradeProfile: {
      upgradeChannel: 'patch'
      nodeOSUpgradeChannel: 'NodeImage'
    }
  }
  dependsOn: [
    vnetRole
  ]
}

resource kubeletAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, cluster.id, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: cluster.properties.identityProfile.kubeletidentity.objectId
    principalType: 'ServicePrincipal'
  }
}

// Pods running as regista/regista-api get Entra tokens for the shared workload identity.
resource federation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2024-11-30' = {
  parent: workloadIdentity
  name: 'aks-${apiNamespace}-${apiServiceAccount}'
  properties: {
    issuer: cluster.properties.oidcIssuerProfile.issuerURL
    subject: 'system:serviceaccount:${apiNamespace}:${apiServiceAccount}'
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: cluster
  properties: {
    workspaceId: logAnalyticsId
    logs: [
      { category: 'kube-audit-admin', enabled: true }
      { category: 'kube-apiserver', enabled: true }
      { category: 'guard', enabled: true }
    ]
    metrics: [
      { category: 'AllMetrics', enabled: true }
    ]
  }
}

output name string = cluster.name
output id string = cluster.id
output oidcIssuerUrl string = cluster.properties.oidcIssuerProfile.issuerURL
output controlPlanePrincipalId string = controlPlaneIdentity.properties.principalId
