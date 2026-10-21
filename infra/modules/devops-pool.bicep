// Managed DevOps Pool: Azure DevOps agents injected into snet-agents, so the pipeline's deploy stage can reach the
// private AKS API server and the private container registry. Agents are stateless VMSS instances that scale to zero.
// Prerequisites (scripts/setup-azure-devops.sh): resource providers Microsoft.DevOpsInfrastructure and
// Microsoft.DevCenter registered, and the tenant's "DevOpsInfrastructure" service principal object id, which needs
// Reader + Network Contributor on the VNet (Microsoft Learn, "Configure networking" for Managed DevOps Pools).

param location string
param tags object
param devCenterName string
param projectName string
param poolName string

@description('Azure DevOps organization URL, e.g. https://dev.azure.com/contoso.')
param organizationUrl string

@description('Object id of the tenant\'s DevOpsInfrastructure service principal.')
param devOpsInfrastructurePrincipalId string

param vnetName string
param subnetId string

param vmSize string = 'Standard_D2ds_v6'

@description('Predefined Azure Pipelines image alias (Microsoft Learn, "Configure images").')
param image string = 'ubuntu-24.04'

param maximumConcurrency int = 1

// Verified on Microsoft Learn (Azure built-in roles).
var readerRoleId = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
var networkContributorRoleId = '4d97b98b-1d4f-4787-a291-c67834d212e7'

resource vnet 'Microsoft.Network/virtualNetworks@2024-07-01' existing = {
  name: vnetName
}

resource vnetRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for roleId in [readerRoleId, networkContributorRoleId]: {
    name: guid(vnet.id, devOpsInfrastructurePrincipalId, roleId)
    scope: vnet
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
      principalId: devOpsInfrastructurePrincipalId
      principalType: 'ServicePrincipal'
    }
  }
]

resource devCenter 'Microsoft.DevCenter/devcenters@2025-02-01' = {
  name: devCenterName
  location: location
  tags: tags
}

resource project 'Microsoft.DevCenter/projects@2025-02-01' = {
  name: projectName
  location: location
  tags: tags
  properties: {
    devCenterId: devCenter.id
  }
}

resource pool 'Microsoft.DevOpsInfrastructure/pools@2025-09-20' = {
  name: poolName
  location: location
  tags: tags
  properties: {
    organizationProfile: {
      kind: 'AzureDevOps'
      organizations: [
        {
          url: organizationUrl
          parallelism: maximumConcurrency
        }
      ]
      permissionProfile: {
        kind: 'CreatorOnly'
      }
    }
    devCenterProjectResourceId: project.id
    maximumConcurrency: maximumConcurrency
    agentProfile: {
      kind: 'Stateless'
    }
    fabricProfile: {
      kind: 'Vmss'
      sku: {
        name: vmSize
      }
      images: [
        {
          wellKnownImageName: image
          buffer: '*'
        }
      ]
      networkProfile: {
        subnetId: subnetId
      }
    }
  }
  dependsOn: [
    vnetRoles
  ]
}

output poolName string = pool.name
