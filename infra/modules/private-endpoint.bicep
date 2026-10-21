// One private endpoint for one sub-resource of a PaaS service, registered in its private DNS zone(s).

param location string
param tags object
param name string
param subnetId string

@description('Resource id of the service, e.g. the storage account.')
param targetId string

@description('Private link sub-resource, e.g. blob, registry, Sql, namespace, account.')
param groupId string

@description('Private DNS zone ids to register the endpoint in.')
param zoneIds array

resource endpoint 'Microsoft.Network/privateEndpoints@2024-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: name
        properties: {
          privateLinkServiceId: targetId
          groupIds: [
            groupId
          ]
        }
      }
    ]
  }
}

resource zoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-07-01' = {
  parent: endpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      for (zoneId, i) in zoneIds: {
        name: 'zone-${i}'
        properties: {
          privateDnsZoneId: zoneId
        }
      }
    ]
  }
}
