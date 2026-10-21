---
agent: agent
description: Check the health of the deployed Regista environment with the Azure MCP Server (read-only).
tools: ['azure-mcp/*']
---

In resource group `${input:resourceGroup:rg-regista}`, read-only:

1. List Container Apps and the feeder job. Report the active revision, replica count and image tag for `regista-api`. Check the Static Web App answers and that the API's `CORS_ORIGINS` matches its URL.
2. Check the Foundry account's model deployments `chat` and `reasoning`: model, version, SKU and capacity.
3. Check the Event Hubs namespace: `match-events` partitions, consumer groups, and whether local auth is disabled.
4. Check Cosmos DB: serverless, local auth disabled, containers present.
5. Summarise anything unhealthy, and give the exact fix as a Bicep change or CLI command. Do not run any change.
