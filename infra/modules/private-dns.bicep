// Private DNS zones for every private endpoint, each linked to the VNet so pods, functions and agents
// resolve the services' public names to their private IPs.

param tags object
param vnetId string

@description('Zone names, e.g. privatelink.azurecr.io.')
param zones array

resource zone 'Microsoft.Network/privateDnsZones@2024-06-01' = [
  for z in zones: {
    name: z
    location: 'global'
    tags: tags
  }
]

resource link 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [
  for (z, i) in zones: {
    parent: zone[i]
    name: 'link-${uniqueString(vnetId)}'
    location: 'global'
    tags: tags
    properties: {
      registrationEnabled: false
      virtualNetwork: {
        id: vnetId
      }
    }
  }
]

output zoneIds object = toObject(zones, z => z, z => resourceId('Microsoft.Network/privateDnsZones', z))
