"""Runtime settings, read once from the environment. Every Azure dependency is optional."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass(frozen=True)
class Settings:
    openai_endpoint: str = field(default_factory=lambda: _env("AZURE_OPENAI_ENDPOINT"))
    chat_deployment: str = field(default_factory=lambda: _env("AZURE_OPENAI_CHAT_DEPLOYMENT", "chat"))
    reasoning_deployment: str = field(default_factory=lambda: _env("AZURE_OPENAI_REASONING_DEPLOYMENT", "reasoning"))
    foundry_project_endpoint: str = field(default_factory=lambda: _env("FOUNDRY_PROJECT_ENDPOINT"))
    ai_services_endpoint: str = field(default_factory=lambda: _env("AZURE_AI_SERVICES_ENDPOINT"))
    ai_services_region: str = field(default_factory=lambda: _env("AZURE_AI_SERVICES_REGION"))
    ai_services_resource_id: str = field(default_factory=lambda: _env("AZURE_AI_SERVICES_RESOURCE_ID"))
    cosmos_endpoint: str = field(default_factory=lambda: _env("COSMOS_ENDPOINT"))
    cosmos_database: str = field(default_factory=lambda: _env("COSMOS_DATABASE", "regista"))
    storage_account_url: str = field(default_factory=lambda: _env("STORAGE_ACCOUNT_URL"))
    eventhub_fqdn: str = field(default_factory=lambda: _env("EVENTHUB_FQDN"))
    eventhub_name: str = field(default_factory=lambda: _env("EVENTHUB_NAME", "match-events"))
    eventhub_consumer_group: str = field(default_factory=lambda: _env("EVENTHUB_CONSUMER_GROUP", "api"))
    live_source: str = field(default_factory=lambda: _env("LIVE_SOURCE", "replay"))
    webpubsub_endpoint: str = field(default_factory=lambda: _env("WEBPUBSUB_ENDPOINT"))
    webpubsub_hub: str = field(default_factory=lambda: _env("WEBPUBSUB_HUB", "regista"))
    onelake_workspace: str = field(default_factory=lambda: _env("ONELAKE_WORKSPACE"))
    onelake_lakehouse: str = field(default_factory=lambda: _env("ONELAKE_LAKEHOUSE"))
    appinsights: str = field(default_factory=lambda: _env("APPLICATIONINSIGHTS_CONNECTION_STRING"))
    cors_origins: str = field(default_factory=lambda: _env("CORS_ORIGINS", "*"))
    public_base_url: str = field(default_factory=lambda: _env("PUBLIC_BASE_URL", "http://localhost:8000"))
    mcp_url: str = field(default_factory=lambda: _env("REGISTA_MCP_URL", f"http://127.0.0.1:{_env('PORT', '8000')}/mcp"))
    force_offline: bool = field(default_factory=lambda: _env("REGISTA_OFFLINE", "").lower() in ("1", "true", "yes"))

    @property
    def llm(self) -> bool:
        return bool(self.openai_endpoint) and not self.force_offline

    @property
    def agents(self) -> bool:
        return bool(self.foundry_project_endpoint) and not self.force_offline

    @property
    def speech(self) -> bool:
        return bool(self.ai_services_region and self.ai_services_resource_id) and not self.force_offline

    @property
    def translator(self) -> bool:
        return bool(self.ai_services_endpoint) and not self.force_offline

    @property
    def safety(self) -> bool:
        return bool(self.ai_services_endpoint) and not self.force_offline

    @property
    def webpubsub(self) -> bool:
        return bool(self.webpubsub_endpoint) and not self.force_offline

    @property
    def mode(self) -> str:
        return "azure" if self.llm else "offline"


settings = Settings()
VERSION = "1.0.0"
