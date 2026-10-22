"""Runtime settings, read once from the environment. Every Azure dependency is optional.

Nothing deployment-specific is hard-coded: endpoints, API versions, limits and timeouts are settings with a sensible
default, overridable by environment variables (Container Apps / AKS app settings) or, locally, by backend/api/.env
(see .env.example; real environment variables win). There are no keys: every Azure call uses a Microsoft Entra token.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

try:  # local development convenience; in Azure the values are app settings. The tests switch it off (REGISTA_DOTENV=0).
    from dotenv import load_dotenv
    if os.environ.get("REGISTA_DOTENV", "1") != "0":
        load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
except ImportError:  # pragma: no cover
    pass


def _env(name: str, default: str = "") -> str:
    """The variable's value, or `default` when it is unset or blank (a manifest may render a missing value as "")."""
    return os.environ.get(name, "").strip() or default


def _env_int(name: str, default: int) -> int:
    return int(_env(name, str(default)))


def _env_float(name: str, default: float) -> float:
    return float(_env(name, str(default)))


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

    # Microsoft Entra: the token scope for Azure OpenAI and the AI Services REST APIs, refreshed this long before expiry
    cognitive_scope: str = field(default_factory=lambda: _env("AZURE_COGNITIVE_SCOPE", "https://cognitiveservices.azure.com/.default"))
    token_refresh_margin_s: int = field(default_factory=lambda: _env_int("AZURE_TOKEN_REFRESH_MARGIN_S", 120))
    # Outbound HTTP (app.integrations.http): one pooled client for every REST call
    http_timeout_s: float = field(default_factory=lambda: _env_float("HTTP_TIMEOUT_S", 20))
    # Azure OpenAI (v1 endpoint, OpenAI SDK)
    openai_api_path: str = field(default_factory=lambda: _env("AZURE_OPENAI_API_PATH", "/openai/v1/"))
    openai_timeout_s: float = field(default_factory=lambda: _env_float("AZURE_OPENAI_TIMEOUT_S", 40))
    openai_max_retries: int = field(default_factory=lambda: _env_int("AZURE_OPENAI_MAX_RETRIES", 2))
    # Azure AI Speech: neural text-to-speech; {region} is AZURE_AI_SERVICES_REGION
    speech_tts_url: str = field(default_factory=lambda: _env("AZURE_SPEECH_TTS_URL", "https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"))
    speech_output_format: str = field(default_factory=lambda: _env("AZURE_SPEECH_OUTPUT_FORMAT", "audio-24khz-48kbitrate-mono-mp3"))
    # Azure AI Translator (custom-domain endpoint of the AI Services account)
    translator_path: str = field(default_factory=lambda: _env("AZURE_TRANSLATOR_PATH", "/translator/text/v3.0/translate"))
    translator_api_version: str = field(default_factory=lambda: _env("AZURE_TRANSLATOR_API_VERSION", "3.0"))
    # Azure AI Content Safety and Prompt Shields
    content_safety_api_version: str = field(default_factory=lambda: _env("AZURE_CONTENT_SAFETY_API_VERSION", "2024-09-01"))
    content_safety_analyze_path: str = field(default_factory=lambda: _env("AZURE_CONTENT_SAFETY_ANALYZE_PATH", "/contentsafety/text:analyze"))
    content_safety_shield_path: str = field(default_factory=lambda: _env("AZURE_CONTENT_SAFETY_SHIELD_PATH", "/contentsafety/text:shieldPrompt"))
    content_safety_max_chars: int = field(default_factory=lambda: _env_int("AZURE_CONTENT_SAFETY_MAX_CHARS", 9000))
    content_safety_block_severity: int = field(default_factory=lambda: _env_int("AZURE_CONTENT_SAFETY_BLOCK_SEVERITY", 4))
    # Shared live broadcast (Web PubSub): how often the viewer count is refreshed, and where counting stops ("10,000+")
    broadcast_viewer_count_interval_s: float = field(default_factory=lambda: _env_float("BROADCAST_VIEWER_COUNT_INTERVAL_S", 5))
    broadcast_viewer_count_max: int = field(default_factory=lambda: _env_int("BROADCAST_VIEWER_COUNT_MAX", 10000))
    # Microsoft Fabric OneLake (ADLS Gen2 DFS endpoint)
    onelake_dfs_endpoint: str = field(default_factory=lambda: _env("ONELAKE_DFS_ENDPOINT", "https://onelake.dfs.fabric.microsoft.com"))

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
