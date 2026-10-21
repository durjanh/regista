"""Deployed-environment checks: the real API, Static Web App and Web PubSub after `azd up`.

    REGISTA_IT_API_URL=$(azd env get-value API_URL) REGISTA_IT_WEB_URL=$(azd env get-value WEB_URL) \\
        pytest -m deployed --no-cov

Skipped unless REGISTA_IT_API_URL is set. The broadcast test starts a shared live broadcast on the showcase match
and stops it again.
"""

from __future__ import annotations

import json
import os
import statistics
import time

import anyio
import httpx
import pytest

from .helpers import HERO, sse_frames

API = os.environ.get("REGISTA_IT_API_URL", "").rstrip("/")
WEB = os.environ.get("REGISTA_IT_WEB_URL", "").rstrip("/")

pytestmark = [pytest.mark.deployed, pytest.mark.skipif(not API, reason="REGISTA_IT_API_URL not set")]
needs_web = pytest.mark.skipif(not WEB, reason="REGISTA_IT_WEB_URL not set")


def client(**kw) -> httpx.Client:
    return httpx.Client(base_url=API, timeout=kw.pop("timeout", 60), follow_redirects=True, **kw)


def test_health():
    with client() as c:
        h = c.get("/api/health").json()
    assert h["status"] == "ok"
    print(f"\nmode {h['mode']} · agents {h['agents_runtime']} · services {json.dumps(h['services'])}")


@needs_web
def test_cors_allows_the_static_web_app():
    with client() as c:
        r = c.get("/api/health", headers={"Origin": WEB})
    assert r.headers.get("access-control-allow-origin") in (WEB, "*")


def test_short_sse_read():
    with client(timeout=httpx.Timeout(60, read=45)) as c, \
            c.stream("GET", f"/api/matches/{HERO}/live", params={"speed": 600, "start_t": 5000}) as r:
        assert r.status_code == 200
        kinds = []
        for kind, _ in sse_frames(r):
            kinds.append(kind)
            if kind in ("event", "end"):
                break
    assert kinds[0] == "meta" and kinds[-1] in ("event", "end")


def test_mcp_tools_list():
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    async def run() -> set[str]:
        async with streamable_http_client(f"{API}/mcp") as (read, write, _), ClientSession(read, write) as session:
            await session.initialize()
            return {t.name for t in (await session.list_tools()).tools}

    assert len(anyio.run(run)) == 14


def test_web_pubsub_broadcast_round_trip():
    with client() as c:
        neg = c.get("/api/realtime/negotiate", params={"match_id": HERO}).json()
    if not neg.get("enabled"):
        pytest.skip("Web PubSub not configured on this deployment")

    from websockets.asyncio.client import connect

    group = f"match.{HERO}"
    latencies: list[float] = []

    async def run() -> None:
        async with connect(neg["url"], subprotocols=["json.webpubsub.azure.v1"]) as ws:
            await ws.send(json.dumps({"type": "joinGroup", "group": group, "ackId": 1}))
            with anyio.fail_after(15):
                while True:
                    msg = json.loads(await ws.recv())
                    if msg.get("type") == "ack" and msg.get("ackId") == 1:
                        assert msg.get("success") or msg.get("error", {}).get("name") == "Duplicate", msg
                        break
            with client() as c:
                c.post(f"/api/broadcast/{HERO}/start", json={"speed": 60, "start_t": 3600}).raise_for_status()
            try:
                with anyio.fail_after(30):
                    while len(latencies) < 3:
                        msg = json.loads(await ws.recv())
                        data = msg.get("data")
                        if isinstance(data, str):
                            data = json.loads(data)
                        if msg.get("type") == "message" and msg.get("group") == group and data.get("type") == "tick":
                            latencies.append(time.time() * 1000 - data["sent_at"])
            finally:
                with client() as c:
                    c.post(f"/api/broadcast/{HERO}/stop")

    anyio.run(run)
    assert len(latencies) >= 2
    print(f"\nWeb PubSub tick delivery: median {statistics.median(latencies):.0f} ms, max {max(latencies):.0f} ms over {len(latencies)} ticks")


@needs_web
def test_static_web_app_serves_the_spa():
    with httpx.Client(timeout=30, follow_redirects=True) as c:
        index = c.get(f"{WEB}/")
        deep = c.get(f"{WEB}/studio/{HERO}")
    assert index.status_code == 200 and '<div id="root"' in index.text
    assert deep.status_code == 200 and '<div id="root"' in deep.text                    # SPA fallback (navigationFallback)
    assert index.headers.get("x-content-type-options") == "nosniff"                    # globalHeaders from staticwebapp.config.json
