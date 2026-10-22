"""The one outbound HTTP client every backend class shares for REST calls.

Azure SDK clients (OpenAI, Cosmos DB, Storage, Event Hubs, Web PubSub) keep their own transports, retries and auth;
this is for the services that only have a REST API (Azure AI Speech, Translator, Content Safety).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import httpx

from ..config import VERSION, settings


class HttpClient:
    """Pooled connections, the timeout from settings, a bearer token per call, and an exception on any non-2xx."""

    def __init__(self, timeout_s: float, user_agent: str = f"regista/{VERSION}",
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._timeout_s = timeout_s
        self._user_agent = user_agent
        self._transport = transport   # tests pass httpx.MockTransport
        self._client: httpx.AsyncClient | None = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout_s, headers={"User-Agent": self._user_agent}, transport=self._transport)
        return self._client

    async def post(self, url: str, *, token: str | None = None, headers: dict[str, str] | None = None,
                   params: dict[str, str] | None = None, json: Any = None, content: bytes | None = None) -> httpx.Response:
        """POST with `Authorization: Bearer <token>` when a token is given. Raises httpx.HTTPStatusError on 4xx/5xx."""
        all_headers = {**(headers or {}), **({"Authorization": f"Bearer {token}"} if token else {})}
        resp = await self.client.post(url, headers=all_headers, params=params, json=json, content=content)
        resp.raise_for_status()
        return resp

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


@lru_cache(maxsize=1)
def http_client() -> HttpClient:
    """The process-wide instance (closed by the app's lifespan on shutdown)."""
    return HttpClient(timeout_s=settings.http_timeout_s)
