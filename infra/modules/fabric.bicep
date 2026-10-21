// Optional Microsoft Fabric capacity. Off by default because an F2 bills while it runs:
// pause it between demos, or use a Fabric trial capacity instead (see docs/DEPLOYMENT.md).
// Workspace, Lakehouse, Eventhouse and Eventstream are created with scripts/fabric-setup.py
// because they are Fabric items, not Azure Resource Manager resources.

param location string
param tags object
param name string

@description('Fabric capacity administrators: Entra user principal names, or object ids for service principals.')
param adminMembers array

@allowed([
  'F2'
  'F4'
  'F8'
  'F16'
  'F32'
  'F64'
])
param skuName string = 'F2'

resource capacity 'Microsoft.Fabric/capacities@2023-11-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: 'Fabric'
  }
  properties: {
    administration: {
      members: adminMembers
    }
  }
}

output name string = capacity.name
output id string = capacity.id
