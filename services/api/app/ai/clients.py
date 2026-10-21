"""Keyless Azure clients: Azure OpenAI (v1 endpoint) and Entra tokens for the AI Services REST APIs."""

from __future__ import annotations

import json
import logging
import time
from functools import lru_cache

from ..config import settings

log = logging.getLogger("regista.ai")
COGNITIVE_SCOPE = "https://cognitiveservices.azure.com/.default"


@lru_cache(maxsize=1)
def credential():
    from azure.identity.aio import DefaultAzureCredential
    return DefaultAzureCredential()


@lru_cache(maxsize=1)
def sync_credential():
    from azure.identity import DefaultAzureCredential
    return DefaultAzureCredential()


_token_cache: dict[str, tuple[str, float]] = {}


async def token(scope: str = COGNITIVE_SCOPE) -> str:
    cached = _token_cache.get(scope)
    if cached and cached[1] - 120 > time.time():
        return cached[0]
    tok = await credential().get_token(scope)
    _token_cache[scope] = (tok.token, tok.expires_on)
    return tok.token


@lru_cache(maxsize=1)
def openai_client():
    from azure.identity.aio import get_bearer_token_provider
    from openai import AsyncOpenAI
    provider = get_bearer_token_provider(credential(), COGNITIVE_SCOPE)
    return AsyncOpenAI(base_url=f"{settings.openai_endpoint.rstrip('/')}/openai/v1/", api_key=provider, max_retries=2, timeout=40)


async def chat(messages: list[dict], *, deployment: str | None = None, json_mode: bool = False,
               max_tokens: int = 900, tools: list[dict] | None = None):
    """One chat completion against Azure OpenAI. Reasoning models get low effort for broadcast-speed latency."""
    client = openai_client()
    kwargs: dict = {"model": deployment or settings.chat_deployment, "messages": messages, "max_completion_tokens": max_tokens}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if tools:
        kwargs["tools"] = tools
    from .. import ops
    try:
        resp = await client.chat.completions.create(reasoning_effort="low", **kwargs)
    except Exception as exc:  # models without reasoning_effort support
        if "reasoning_effort" in str(exc) or "unsupported" in str(exc).lower():
            resp = await client.chat.completions.create(**kwargs)
        else:
            raise
    usage = getattr(resp, "usage", None)
    ops.record_usage(getattr(usage, "prompt_tokens", 0), getattr(usage, "completion_tokens", 0))
    return resp


async def chat_json(system: str, user: str, *, deployment: str | None = None, max_tokens: int = 1200) -> dict:
    resp = await chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                      deployment=deployment, json_mode=True, max_tokens=max_tokens)
    text = resp.choices[0].message.content or "{}"
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        return json.loads(text[start:end + 1]) if start >= 0 else {}
