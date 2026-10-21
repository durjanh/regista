// Deterministic resource names. Same inputs always produce the same names, so every
// deployment of the template is idempotent and safe to re-run.

@export()
@description('Short, stable, lowercase token derived from the subscription, resource group and environment.')
func token(subscriptionId string, resourceGroupId string, environmentName string) string =>
  take(toLower(uniqueString(subscriptionId, resourceGroupId, environmentName)), 8)

@export()
@description('Alphanumeric-only name for resources that forbid hyphens (storage, ACR).')
func compact(prefix string, environmentName string, tok string) string =>
  take(toLower(replace('${prefix}${environmentName}${tok}', '-', '')), 24)

@export()
@description('Hyphenated name for resources that allow it.')
func dashed(prefix string, environmentName string, tok string) string =>
  toLower('${prefix}-${environmentName}-${tok}')
