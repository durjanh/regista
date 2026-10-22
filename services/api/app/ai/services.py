"""Azure AI Services over REST with Microsoft Entra tokens: Speech (neural TTS), Translator and Content Safety.

`AzureAIServices` takes its collaborators (the shared HTTP client, a token provider, the settings) in its constructor;
every endpoint, path, API version and limit comes from the settings. The module-level functions are the facade the
agents import (`from .services import translate`).
"""

from __future__ import annotations

import html
import logging
from collections.abc import Awaitable, Callable

from ..config import Settings, settings
from ..integrations.http import HttpClient, http_client
from . import clients
from .personas import VOICE_LOCALES, VOICES

log = logging.getLogger("regista.services")

TokenProvider = Callable[[], Awaitable[str]]


class AzureAIServices:
    def __init__(self, http: HttpClient, token: TokenProvider, cfg: Settings) -> None:
        self._http = http
        self._token = token
        self._cfg = cfg

    def _url(self, path: str) -> str:
        return f"{self._cfg.ai_services_endpoint.rstrip('/')}{path}"

    async def synthesize(self, text: str, language: str = "en", persona: str | None = None) -> bytes:
        """Neural text-to-speech. Raises RuntimeError when Speech is not configured."""
        if not self._cfg.speech:
            raise RuntimeError("speech not configured")
        voice = VOICES.get(language, VOICES["en"])
        locale = VOICE_LOCALES.get(language, "en-GB")
        rate = "+8%" if persona in ("broadcaster", "social") else "-6%" if persona in ("kids", "accessible") else "+0%"
        ssml = (f"<speak version='1.0' xml:lang='{locale}'><voice name='{voice}'><prosody rate='{rate}'>"
                f"{html.escape(text)}</prosody></voice></speak>")
        # Speech takes an Entra token bound to the resource: "aad#<resource id>#<token>".
        token = f"aad#{self._cfg.ai_services_resource_id}#{await self._token()}"
        resp = await self._http.post(
            self._cfg.speech_tts_url.format(region=self._cfg.ai_services_region), token=token,
            headers={"Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": self._cfg.speech_output_format},
            content=ssml.encode("utf-8"))
        return resp.content

    async def translate(self, texts: list[str], to: str) -> list[str]:
        """Azure Translator (custom-domain endpoint, Entra token). Raises RuntimeError when not configured."""
        if not self._cfg.translator:
            raise RuntimeError("translator not configured")
        if not texts:
            return []
        resp = await self._http.post(self._url(self._cfg.translator_path), token=await self._token(),
                                     params={"api-version": self._cfg.translator_api_version, "to": to},
                                     json=[{"Text": t} for t in texts])
        return [item["translations"][0]["text"] for item in resp.json()]

    async def moderate(self, text: str) -> dict:
        """Content Safety text analysis. Returns {'flagged': bool, 'categories': {...}} or {'skipped': True}."""
        if not self._cfg.safety or not text.strip():
            return {"skipped": True}
        try:
            resp = await self._http.post(self._url(self._cfg.content_safety_analyze_path), token=await self._token(),
                                         params={"api-version": self._cfg.content_safety_api_version},
                                         json={"text": text[: self._cfg.content_safety_max_chars]})
            cats = {c["category"]: c.get("severity", 0) for c in resp.json().get("categoriesAnalysis", [])}
            return {"flagged": any(v >= self._cfg.content_safety_block_severity for v in cats.values()), "categories": cats}
        except Exception as exc:
            log.warning("Content Safety call failed: %s", exc)
            return {"skipped": True, "error": str(exc)[:200]}

    async def shield_prompt(self, user_prompt: str) -> bool:
        """Prompt Shields: True when a jailbreak / prompt-injection attempt is detected in a user question."""
        if not self._cfg.safety:
            return False
        try:
            resp = await self._http.post(self._url(self._cfg.content_safety_shield_path), token=await self._token(),
                                         params={"api-version": self._cfg.content_safety_api_version},
                                         json={"userPrompt": user_prompt[: self._cfg.content_safety_max_chars], "documents": []})
            return bool(resp.json().get("userPromptAnalysis", {}).get("attackDetected"))
        except Exception as exc:
            log.warning("Prompt Shields call failed: %s", exc)
            return False


def http() -> HttpClient:
    return http_client()


def ai_services() -> AzureAIServices:
    """Built per call from this module's collaborators, so a test can swap `http`, `clients.token` or `settings`."""
    return AzureAIServices(http=http(), token=clients.token, cfg=settings)


async def synthesize(text: str, language: str = "en", persona: str | None = None) -> bytes:
    return await ai_services().synthesize(text, language, persona)


async def translate(texts: list[str], to: str) -> list[str]:
    return await ai_services().translate(texts, to)


async def moderate(text: str) -> dict:
    return await ai_services().moderate(text)


async def shield_prompt(user_prompt: str) -> bool:
    return await ai_services().shield_prompt(user_prompt)
