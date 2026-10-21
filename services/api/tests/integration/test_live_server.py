"""Integration: a real uvicorn server (offline), exercised over real sockets: REST, CORS, SSE, MCP, broadcast, video-safe."""

from __future__ import annotations

import queue
import statistics
import threading
import time

import anyio
import httpx
import pytest

from .helpers import ALLOWED_ORIGIN, HERO, sse_frames

pytestmark = pytest.mark.integration

EXPECTED_TOOLS = {"list_matches", "get_match_state", "get_key_moments", "explain_moment", "get_player_stats", "get_tactical_summary",
                  "get_xg_breakdown", "compare_periods", "get_head_to_head", "get_team_history", "get_player_dna", "get_team_report",
                  "get_dugout_advice", "generate_what_if"}


# ---------------------------------------------------------------- REST

def test_health_and_core_endpoints(server):
    with server.client() as c:
        h = c.get("/api/health").json()
        assert h["status"] == "ok" and h["mode"] == "offline" and h["services"]["webpubsub"] is False

        matches = c.get("/api/matches").json()
        hero = next(m for m in matches if m["match_id"] == HERO)
        assert hero["planted_changes"] >= 2

        analysis = c.get(f"/api/matches/{HERO}/analysis").json()
        assert analysis["score"] == {"home": 1, "away": 2}

        insights = c.get(f"/api/matches/{HERO}/insights").json()
        assert any(i["mechanism"] == "press_switch" and i["team_id"] == "argentina" for i in insights)

        truth = c.get(f"/api/matches/{HERO}/truth").json()
        assert truth["grades"] and all(g["detected"] for g in truth["grades"])

        events = c.get(f"/api/matches/{HERO}/events", params={"to_t": 600}).json()
        assert events and all(e["t"] <= 600 for e in events)


def test_errors_are_proper_http_errors(server):
    with server.client() as c:
        assert c.get("/api/matches/no-such-match/analysis").status_code == 404
        assert c.get("/api/matches/no-such-match/live").status_code == 404
        assert c.get(f"/api/matches/{HERO}/live", params={"speed": "fast"}).status_code == 422
        assert c.post(f"/api/broadcast/{HERO}/start", json={"speed": 0}).status_code == 422
        assert c.post(f"/api/studio/{HERO}/items/no-such-item", json={"action": "approve"}).status_code == 404


# ---------------------------------------------------------------- CORS (the SPA on Static Web Apps calls the API cross-origin)

def test_cors_allows_only_the_static_web_app(server):
    with server.client() as c:
        ok = c.get("/api/health", headers={"Origin": ALLOWED_ORIGIN})
        assert ok.headers.get("access-control-allow-origin") == ALLOWED_ORIGIN

        pre = c.options(f"/api/broadcast/{HERO}/start", headers={
            "Origin": ALLOWED_ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
        assert pre.status_code == 200
        assert pre.headers.get("access-control-allow-origin") == ALLOWED_ORIGIN
        assert "POST" in pre.headers.get("access-control-allow-methods", "")

        bad = c.get("/api/health", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in bad.headers


# ---------------------------------------------------------------- SSE over the wire

def test_live_stream_end_to_end_with_verifier_drill(server):
    params = {"speed": 600, "start_t": 3600, "persona": "analyst", "drill": "true"}
    frames: list[tuple[str, object]] = []
    with server.client(timeout=httpx.Timeout(90, read=60)) as c, c.stream("GET", f"/api/matches/{HERO}/live", params=params) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        for frame in sse_frames(r):
            frames.append(frame)
            if frame[0] == "end":
                break
    kinds = [k for k, _ in frames]
    assert kinds[0] == "meta" and frames[0][1]["match_id"] == HERO
    assert "event" in kinds and "snapshot" in kinds and kinds[-1] == "end"
    ts = [d["t"] for k, d in frames if k == "event"]
    assert ts == sorted(ts) and ts[0] >= 3600
    narrated = [d for k, d in frames if k == "insight" and isinstance(d, dict) and d.get("narrative")]
    press = next(d for d in narrated if d["mechanism"] == "press_switch")
    v = press["narrative"]["verification"]
    assert v["drill"] and v["caught"] and v["planted"]["planted"] not in press["narrative"]["text"]


def test_overlay_receives_on_air_and_kill(server):
    got: queue.Queue = queue.Queue()
    ready = threading.Event()
    stop = threading.Event()

    def listen() -> None:
        with httpx.Client(base_url=server.base, timeout=httpx.Timeout(30, read=25)) as c, \
                c.stream("GET", f"/api/studio/{HERO}/overlay") as r:
            for kind, data in sse_frames(r):
                if kind == "ready":
                    ready.set()
                else:
                    got.put((kind, data))
                if stop.is_set():
                    return

    t = threading.Thread(target=listen, daemon=True)
    t.start()
    assert ready.wait(20), "overlay stream never sent ready"
    with server.client() as c:
        items = c.get(f"/api/studio/{HERO}/queue").json()
        item = next(i for i in items if i.get("editorial", {}).get("passed", True))
        assert c.post(f"/api/studio/{HERO}/items/{item['id']}", json={"action": "approve"}).status_code == 200
        assert c.post(f"/api/studio/{HERO}/items/{item['id']}", json={"action": "on_air"}).status_code == 200
        kind, data = got.get(timeout=10)
        assert kind == "on_air" and data["id"] == item["id"]
        assert c.post(f"/api/studio/{HERO}/items/{item['id']}", json={"action": "kill"}).json()["status"] == "killed"
        kind, data = got.get(timeout=10)
        assert kind == "kill" and data["id"] == item["id"]
        audit = c.get(f"/api/studio/{HERO}/audit").json()
        assert {"approve", "on_air", "kill"} <= {a["action"] for a in audit if a["item_id"] == item["id"]}
    stop.set()


# ---------------------------------------------------------------- MCP over streamable HTTP

def test_mcp_over_streamable_http(server):
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    async def run() -> tuple[set[str], str, str]:
        async with streamable_http_client(f"{server.base}/mcp") as (read, write, _), ClientSession(read, write) as session:
            await session.initialize()
            tools = {t.name for t in (await session.list_tools()).tools}
            listed = await session.call_tool("list_matches", {})
            moments = await session.call_tool("get_key_moments", {"match_id": HERO, "min_importance": 70})
            text = lambda res: " ".join(getattr(c, "text", "") for c in res.content)  # noqa: E731
            return tools, text(listed), text(moments)

    tools, listed, moments = anyio.run(run)
    assert tools == EXPECTED_TOOLS
    assert HERO in listed
    assert "Martínez" in moments or "GOAL" in moments.upper()


# ---------------------------------------------------------------- broadcast (Web PubSub disabled: lifecycle still works)

def test_broadcast_lifecycle_without_web_pubsub(server):
    with server.client() as c:
        assert c.get("/api/realtime/negotiate", params={"match_id": HERO}).json()["enabled"] is False
        started = c.post(f"/api/broadcast/{HERO}/start", json={"speed": 120, "start_t": 3000, "languages": ["en", "es"]}).json()
        assert started["live"] is True and started["match_id"] == HERO
        again = c.post(f"/api/broadcast/{HERO}/start", json={"speed": 120}).json()
        assert again["live"] is True and again["started_at"] == started["started_at"]          # idempotent while live
        time.sleep(2.5)
        status = {s["match_id"]: s for s in c.get("/api/broadcast/status").json()}
        assert status[HERO]["live"] and status[HERO]["t"] > 3000                             # the shared clock advances
        stopped = c.post(f"/api/broadcast/{HERO}/stop").json()
        assert stopped["live"] is False


# ---------------------------------------------------------------- video-safe mode

MARKS = ("World Cup", "FIFA", "UEFA", "Copa América")


def test_video_safe_scrubs_json_and_sse(server, safe_server):
    with server.client() as c:
        assert any(m in c.get("/api/matches").text for m in MARKS)                            # sanity: the raw data has them
    with safe_server.client(timeout=httpx.Timeout(60, read=30)) as c:
        assert c.get("/api/health").json()["video_safe"] is True
        body = c.get("/api/matches").text + c.get(f"/api/matches/{HERO}").text
        assert not any(m in body for m in MARKS)
        seen = []
        with c.stream("GET", f"/api/matches/{HERO}/live", params={"speed": 600, "start_t": 5000}) as r:
            for kind, data in sse_frames(r):
                seen.append(str(data))
                if kind == "end" or len(seen) > 400:
                    break
        assert seen and not any(m in s for s in seen for m in MARKS)


# ---------------------------------------------------------------- light concurrency

def test_thirty_concurrent_sse_viewers(server):
    n, window = 30, 4.0
    firsts: list[float] = []
    counts: list[int] = []

    async def viewer(client: httpx.AsyncClient) -> None:
        start = time.perf_counter()
        received = 0
        async with client.stream("GET", f"/api/matches/{HERO}/live", params={"speed": 60, "start_t": 1200}) as r:
            async for line in r.aiter_lines():
                if line.startswith("event: event"):
                    if received == 0:
                        firsts.append(time.perf_counter() - start)
                    received += 1
                if time.perf_counter() - start > window:
                    break
        counts.append(received)

    async def run() -> None:
        limits = httpx.Limits(max_connections=n + 5)
        async with httpx.AsyncClient(base_url=server.base, timeout=httpx.Timeout(30, read=15), limits=limits) as client, \
                anyio.create_task_group() as tg:
            for _ in range(n):
                tg.start_soon(viewer, client)

    anyio.run(run)
    assert len(counts) == n and all(c > 0 for c in counts), counts
    p95 = sorted(firsts)[int(0.95 * (len(firsts) - 1))]
    print(f"\n{n} concurrent SSE viewers: first event p50 {statistics.median(firsts) * 1000:.0f} ms, p95 {p95 * 1000:.0f} ms, "
          f"events per viewer in {window:.0f} s: min {min(counts)} / median {statistics.median(counts):.0f}")
    assert p95 < 5.0
