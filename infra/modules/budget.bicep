// Monthly cost budget on the resource group with e-mail alerts (set a budget alert on day one).
targetScope = 'resourceGroup'

@description('Budget name.')
param name string

@description('Monthly budget amount in the billing currency.')
@minValue(1)
param amount int

@description('E-mail addresses that receive the alerts.')
param contactEmails array

@description('First day of the budget period (YYYY-MM-01). Must not be before the current month.')
param startDate string

resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: name
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
    }
    notifications: {
      actual50: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: contactEmails
      }
      actual90: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 90
        thresholdType: 'Actual'
        contactEmails: contactEmails
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: contactEmails
      }
    }
  }
}

output budgetName string = budget.name
