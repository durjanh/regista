// Enterprise network: one VNet, one subnet per tier, an NSG on every subnet.
//
//   snet-aks        AKS nodes (Azure CNI overlay: pods use 192.168.0.0/16 off the VNet) + private API server endpoint
//   snet-ingress    internal load balancer of the private NGINX ingress (static IP ingressPrivateIp)
//   snet-apim       API Management Standard v2 outbound VNet integration (delegated to Microsoft.Web/serverFarms)
//   snet-pe         private endpoints for ACR, Storage, Cosmos DB, Event Hubs and Foundry
//   snet-functions  Functions Flex Consumption VNet integration (delegated to Microsoft.App/environments)
//   snet-agents     Managed DevOps Pool agents that deploy to the private cluster (delegated to Microsoft.DevOpsInfrastructure/pools)

param location string
param tags object
param vnetName string
param addressPrefix string = '10.40.0.0/16'

var subnets = [
  { name: 'snet-aks', prefix: '10.40.0.0/22', delegation: '' }
  { name: 'snet-ingress', prefix: '10.40.4.0/24', delegation: '' }
  { name: 'snet-apim', prefix: '10.40.5.0/24', delegation: 'Microsoft.Web/serverFarms' }
  { name: 'snet-pe', prefix: '10.40.6.0/24', delegation: '' }
  { name: 'snet-functions', prefix: '10.40.7.0/24', delegation: 'Microsoft.App/environments' }
  { name: 'snet-agents', prefix: '10.40.8.0/24', delegation: 'Microsoft.DevOpsInfrastructure/pools' }
]

// API Management v2 outbound integration requires an NSG on its subnet that allows Key Vault on 443.
var apimRules = [
  {
    name: 'allow-keyvault-outbound'
    properties: {
      priority: 100
      direction: 'Outbound'
      access: 'Allow'
      protocol: 'Tcp'
      sourceAddressPrefix: 'VirtualNetwork'
      sourcePortRange: '*'
      destinationAddressPrefix: 'AzureKeyVault'
      destinationPortRange: '443'
    }
  }
]

resource nsgs 'Microsoft.Network/networkSecurityGroups@2024-07-01' = [
  for s in subnets: {
    name: 'nsg-${vnetName}-${s.name}'
    location: location
    tags: tags
    properties: {
      securityRules: s.name == 'snet-apim' ? apimRules : []
    }
  }
]

resource vnet 'Microsoft.Network/virtualNetworks@2024-07-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        addressPrefix
      ]
    }
    subnets: [
      for (s, i) in subnets: {
        name: s.name
        properties: {
          addressPrefix: s.prefix
          networkSecurityGroup: {
            id: nsgs[i].id
          }
          privateEndpointNetworkPolicies: s.name == 'snet-pe' ? 'Enabled' : 'Disabled'
          delegations: empty(s.delegation)
            ? []
            : [
                {
                  name: replace(s.delegation, '/', '.')
                  properties: {
                    serviceName: s.delegation
                  }
                }
              ]
        }
      }
    ]
  }
}

output id string = vnet.id
output name string = vnet.name
output aksSubnetId string = '${vnet.id}/subnets/snet-aks'
output ingressSubnetName string = 'snet-ingress'
output apimSubnetId string = '${vnet.id}/subnets/snet-apim'
output privateEndpointSubnetId string = '${vnet.id}/subnets/snet-pe'
output functionsSubnetId string = '${vnet.id}/subnets/snet-functions'
output agentsSubnetId string = '${vnet.id}/subnets/snet-agents'
