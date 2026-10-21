"""Azure AI Services over REST with Microsoft Entra tokens: Speech (neural TTS), Translator and Content Safety."""

from __future__ import annotations

import html
import logging

import httpx

from ..config import settings
from . import clients
from .personas import VOICE_LOCALES, VOICES

log = logging.getLogger("regista.services")
_http: httpx.AsyncClient | None = None


def http() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=20)
    return _http


async def synthesize(text: str, language: str = "en", persona: str | None = None) -> bytes:
    """Neural text-to-speech. Raises RuntimeError when Speech is not configured."""
    if not settings.speech:
        raise RuntimeError("speech not configured")
    voice = VOICES.get(language, VOICES["en"])
    locale = VOICE_LOCALES.get(language, "en-GB")
    rate = "+8%" if persona in ("broadcaster", "social") else "-6%" if persona in ("kids", "accessible") else "+0%"
    ssml = (f"<speak version='1.0' xml:lang='{locale}'><voice name='{voice}'><prosody rate='{rate}'>"
            f"{html.escape(text)}</prosody></voice></speak>")
    tok = await clients.token()
    resp = await http().post(
        f"https://{settings.ai_services_region}.tts.speech.microsoft.com/cognitiveservices/v1",
        headers={"Authorization": f"Bearer aad#{settings.ai_services_resource_id}#{tok}",
                 "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
                 "User-Agent": "regista"},
        content=ssml.encode("utf-8"))
    resp.raise_for_status()
    return resp.content


async def translate(texts: list[str], to: str) -> list[str]:
    """Azure Translator (custom-domain endpoint, Entra token). Raises RuntimeError when not configured."""
    if not settings.translator:
        raise RuntimeError("translator not configured")
    if not texts:
        return []
    tok = await clients.token()
    url = f"{settings.ai_services_endpoint.rstrip('/')}/translator/text/v3.0/translate"
    resp = await http().post(url, params={"api-version": "3.0", "to": to}, json=[{"Text": t} for t in texts],
                             headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    resp.raise_for_status()
    return [item["translations"][0]["text"] for item in resp.json()]


async def moderate(text: str) -> dict:
    """Azure AI Content Safety text analysis. Returns {'flagged': bool, 'categories': {...}} or {'skipped': True}."""
    if not settings.safety or not text.strip():
        return {"skipped": True}
    try:
        tok = await clients.token()
        url = f"{settings.ai_services_endpoint.rstrip('/')}/contentsafety/text:analyze"
        resp = await http().post(url, params={"api-version": "2024-09-01"}, json={"text": text[:9000]},
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
        resp.raise_for_status()
        cats = {c["category"]: c.get("severity", 0) for c in resp.json().get("categoriesAnalysis", [])}
        return {"flagged": any(v >= 4 for v in cats.values()), "categories": cats}
    except Exception as exc:
        log.warning("Content Safety call failed: %s", exc)
        return {"skipped": True, "error": str(exc)[:200]}


async def shield_prompt(user_prompt: str) -> bool:
    """Prompt Shields: True when a jailbreak / prompt-injection attempt is detected in a user question."""
    if not settings.safety:
        return False
    try:
        tok = await clients.token()
        url = f"{settings.ai_services_endpoint.rstrip('/')}/contentsafety/text:shieldPrompt"
        resp = await http().post(url, params={"api-version": "2024-09-01"}, json={"userPrompt": user_prompt[:9000], "documents": []},
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
        resp.raise_for_status()
        return bool(resp.json().get("userPromptAnalysis", {}).get("attackDetected"))
    except Exception as exc:
        log.warning("Prompt Shields call failed: %s", exc)
        return False
