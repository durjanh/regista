"""Realtime broadcast over Azure Web PubSub, with a fake service client (nothing leaves the machine)."""

from __future__ import annotations

import asyncio
import dataclasses
import json

import pytest
from fastapi.testclient import TestClient

from app.live import broadcast
from app.live.broadcast import Broadcast
from tests.conftest import HERO


class FakeWebPubSub:
    def __init__(self, fail: bool = False):
        self.fail = fail
        self.sent: list[tuple[str, dict]] = []
        self.tokens: list[dict] = []
        self.closed = False

    async def get_client_access_token(self, roles=None, minutes_to_expire=60, **kw):
        self.tokens.append({"roles": roles, "minutes_to_expire": minutes_to_expire})
        return {"url": "wss://fake.webpubsub.azure.com/client/hubs/regista?access_token=t", "token": "t"}

    async def send_to_group(self, group, message, content_type=None, **kw):
        if self.fail:
            raise RuntimeError("service unavailable")
        assert content_type == "application/json"
        self.sent.append((group, json.loads(message)))

    async def close(self):
        self.closed = True

    def to(self, group: str) -> list[dict]:
        return [m for g, m in self.sent if g == group]


@pytest.fixture
def wps(monkeypatch, loaded_store):
    fake = FakeWebPubSub()
    monkeypatch.setattr(broadcast, "enabled", lambda: True)
    monkeypatch.setattr(broadcast, "client", lambda: fake)
    monkeypatch.setattr(broadcast, "TICK_SECONDS", 0)
    return fake


@pytest.fixture
def quiet_narration(monkeypatch):
    """Count narrative calls; return canned grounded narratives (the narrator itself is tested elsewhere)."""
    calls: list[tuple[str, str, str]] = []

    async def narrate(match_id, scope, persona, language, moment_id=None, upto_t=None):
        calls.append(("moment", moment_id, language))
        return {"text": f"moment {moment_id} in {language}", "citations": [], "fact_check": {"passed": True}, "scope": "moment",
                "persona": persona, "engine": "offline"}

    async def narrate_insight(match_id, insight, persona, language, drill=False):
        calls.append(("insight", insight["id"], language))
        return {"text": f"insight {insight['id']} in {language}", "citations": [], "fact_check": {"passed": True}, "verification": None,
                "scope": "insight", "persona": persona, "engine": "offline"}

    monkeypatch.setattr(broadcast, "narrate", narrate)
    monkeypatch.setattr(broadcast, "narrate_insight", narrate_insight)
    return calls


@pytest.fixture(scope="module")
def client(loaded_store):
    from app.main import app
    return TestClient(app)        # no lifespan: the app's MCP session manager may only start once per process


def test_negotiate_offline_falls_back_to_sse(client):
    assert client.get("/api/realtime/negotiate", params={"match_id": HERO}).json() == {"enabled": False}
    assert client.get("/api/realtime/negotiate", params={"match_id": "nope"}).status_code == 404


def test_negotiate_issues_join_only_roles_for_this_match(wps):
    r = asyncio.run(broadcast.negotiate(HERO, "es"))
    groups = [f"match.{HERO}", f"match.{HERO}.es", f"overlay.{HERO}"]
    assert r["enabled"] and r["url"].startswith("wss://") and r["groups"] == groups and r["hub"] == "regista"
    assert wps.tokens == [{"roles": [f"webpubsub.joinLeaveGroup.{g}" for g in groups], "minutes_to_expire": 60}]


def test_start_stop_status_are_idempotent(wps, monkeypatch):
    monkeypatch.setattr(broadcast, "TICK_SECONDS", 0.05)

    async def run():
        first = broadcast.start(HERO, 1, 600, ["en", "xx", "en"])
        again = broadcast.start(HERO, 30)
        listed = broadcast.status()
        stopped = broadcast.stop(HERO)
        await asyncio.sleep(0)
        return first, again, listed, stopped
    first, again, listed, stopped = asyncio.run(run())
    assert first["live"] and first["source"] == "replay" and first["languages"] == ["en"]       # unknown and duplicate languages dropped
    assert again["started_at"] == first["started_at"] and again["speed"] == 1                     # second start returns the live one
    assert any(s["match_id"] == HERO and s["live"] for s in listed) and stopped["live"] is False


def test_broadcast_endpoints(client, monkeypatch):
    seen = {}

    def fake_start(match_id, speed, start_t, languages):
        seen.update(match_id=match_id, speed=speed, start_t=start_t, languages=languages)
        return {"match_id": match_id, "live": True}
    monkeypatch.setattr(broadcast, "start", fake_start)
    assert client.post(f"/api/broadcast/{HERO}/start", json={"speed": 30, "languages": ["en", "es"]}).json()["live"]
    assert seen == {"match_id": HERO, "speed": 30, "start_t": 0, "languages": ["en", "es"]}
    other = "2024-07-14-spain-england"
    assert client.post(f"/api/broadcast/{other}/stop").json() == broadcast.Broadcast(other, "replay").status()
    assert isinstance(client.get("/api/broadcast/status").json(), list)
    assert client.post(f"/api/broadcast/{HERO}/start", json={"speed": 0}).status_code == 422
    assert client.post("/api/broadcast/nope/start", json={}).status_code == 404
    assert client.post("/api/broadcast/nope/stop").status_code == 404
    assert client.get("/api/health").json()["services"]["webpubsub"] is False


def test_tick_is_batched_small_and_has_no_freeze_frames(wps, loaded_store):
    an = loaded_store.analyzer(HERO)
    b = Broadcast(HERO, "replay")
    b.seed(600)
    sizes = []

    async def run():
        for second in range(600, 900):
            batch = [e for e in an.events if second < e["t"] <= second + 1]
            payload = await b.tick(batch, second + 1)
            assert all("freeze_frame" not in e for e in payload["events"])
            sizes.append(len(json.dumps(payload, separators=(",", ":"))))
    asyncio.run(run())
    sizes.sort()
    assert sizes[len(sizes) // 2] < 2048                     # typical tick fits one 2 KB billing chunk
    ticks = wps.to(f"match.{HERO}")
    assert len(ticks) == 300 and [t["seq"] for t in ticks] == list(range(1, 301))
    assert {"momentum", "win_prob", "control_chaos"} == set(ticks[-1]["snapshot"]) and isinstance(ticks[-1]["sent_at"], int)
    assert b.ticks_published == 300 and b.bytes_published >= sum(sizes)


def test_full_replay_narrates_once_per_language_and_ends(wps, quiet_narration, loaded_store):
    b = Broadcast(HERO, "replay", speed=600, start_t=0, languages=["en", "es"], live=True)
    asyncio.run(b.run_replay())
    moments = [m for t in wps.to(f"match.{HERO}") if t["type"] == "tick" for m in t["moments"]]
    assert moments and len({m["id"] for m in moments}) == len(moments)                    # each moment published once
    for kind, ref, _lang in quiet_narration:
        assert sum(1 for c in quiet_narration if c[:2] == (kind, ref)) == 2                 # once per language, never per viewer
    assert {m["ref_id"] for m in wps.to(f"match.{HERO}.es")} == {m["ref_id"] for m in wps.to(f"match.{HERO}.en")}
    assert wps.to(f"match.{HERO}")[-1]["type"] == "end" and b.live is False
    narr = wps.to(f"match.{HERO}.en")
    assert {n["scope"] for n in narr} <= {"moment", "insight"} and all(n["engine"] == "offline" and n["persona"] for n in narr)
    assert {n["persona"] for n in narr if n["scope"] == "moment"} == {"broadcaster"}


def test_late_joiners_load_history_up_to_a_tick(client):
    upto = client.get(f"/api/matches/{HERO}/events", params={"to_t": 600}).json()
    assert upto and max(e["t"] for e in upto) <= 600 and min(e["t"] for e in upto) >= 0


def test_studio_cues_reach_the_overlay_group_and_sse(wps, loaded_store):
    from app.ai import producer
    match_id = "2024-07-10-netherlands-england"

    async def run():
        q = producer.subscribe(match_id)
        item = next(i for i in producer.propose(match_id, None) if i["editorial"]["passed"])
        producer.act(match_id, item["id"], "on_air")
        producer.act(match_id, item["id"], "kill")
        await asyncio.sleep(0.01)
        producer.unsubscribe(match_id, q)
        return item, [q.get_nowait() for _ in range(q.qsize())]
    item, sse = asyncio.run(run())
    cues = wps.to(f"overlay.{match_id}")
    assert [c["action"] for c in cues] == ["on_air", "kill"] and cues[0]["item"]["id"] == item["id"]
    assert [kind for kind, _ in sse] == ["on_air", "kill"]                                  # SSE overlays still get them
    producer._overlay_cue(match_id, "kill", {"id": "x"})                                    # no running loop: skipped, no error


def test_eventhub_source_publishes_what_arrived(wps, quiet_narration, loaded_store):
    from app.live.replay import hub
    events = [dict(e, match_id=HERO, seq=n + 1) for n, e in enumerate(loaded_store.docs[HERO]["events"][:40])]
    for e in events:
        hub.push(e)
    hub.push({**events[-1], "id": "ft", "seq": 41, "type": "full_time"})
    b = Broadcast(HERO, "eventhub", languages=["en"], live=True)
    asyncio.run(b.run_eventhub())
    ticks = wps.to(f"match.{HERO}")
    assert sum(len(t["events"]) for t in ticks if t["type"] == "tick") == 41 and ticks[-1]["type"] == "end"
    hub.events[HERO] = []


def test_eventhub_restart_resets_the_cursor(wps, loaded_store, monkeypatch):
    from app.live.replay import hub
    b = Broadcast(HERO, "eventhub", live=True)
    first = dict(loaded_store.docs[HERO]["events"][0], match_id=HERO, seq=1)
    hub.events[HERO] = [first, dict(first, seq=2), dict(first, seq=3)]
    calls = {"n": 0}

    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] == 1:
            hub.events[HERO] = [dict(first, seq=1, type="full_time")]          # new feed: buffer shorter than the cursor
    monkeypatch.setattr(broadcast.asyncio, "sleep", fake_sleep)
    asyncio.run(b.run_eventhub())
    assert [len(t["events"]) for t in wps.to(f"match.{HERO}") if t["type"] == "tick"] == [3, 1]
    hub.events[HERO] = []


def test_publish_failures_never_break_the_loop(monkeypatch, loaded_store):
    fake = FakeWebPubSub(fail=True)
    monkeypatch.setattr(broadcast, "enabled", lambda: True)
    monkeypatch.setattr(broadcast, "client", lambda: fake)
    b = Broadcast(HERO, "replay")
    payload = asyncio.run(b.tick([], 120))
    assert payload["type"] == "tick" and b.ticks_published == 0 and b.bytes_published == 0
    assert asyncio.run(broadcast.publish("g", {"a": 1})) == 0


def test_offline_publish_is_a_no_op(loaded_store):
    assert asyncio.run(broadcast.publish("g", {"a": 1})) == 0


def test_video_safe_scrubs_published_payloads(wps, monkeypatch):
    monkeypatch.setattr(broadcast, "VIDEO_SAFE", True)
    asyncio.run(broadcast.publish("g", {"title": "FIFA World Cup semi-final"}))
    assert wps.sent[-1][1]["title"] == "World tournament semi-final"


def test_a_crashing_broadcast_is_contained(wps, monkeypatch):
    async def boom(self):
        raise RuntimeError("bad feed")
    monkeypatch.setattr(Broadcast, "run_replay", boom)

    async def run():
        status = broadcast.start("2026-07-18-france-england", speed=10)
        await broadcast._broadcasts["2026-07-18-france-england"].task
        return status
    assert asyncio.run(run())["live"] is True
    assert broadcast._broadcasts["2026-07-18-france-england"].live is False


def test_shutdown_stops_broadcasts_and_closes_the_client(wps, monkeypatch):
    monkeypatch.setattr(broadcast, "_client", wps)

    async def run():
        broadcast.start("2022-11-23-germany-japan", speed=600)
        await asyncio.sleep(0)
        await broadcast.shutdown()
    asyncio.run(run())
    assert wps.closed and not broadcast._broadcasts["2022-11-23-germany-japan"].live


def test_client_is_entra_authenticated_and_cached(monkeypatch):
    from app import config
    monkeypatch.setattr(broadcast, "settings", dataclasses.replace(config.settings, webpubsub_endpoint="https://fake.webpubsub.azure.com",
                                                                   force_offline=False))
    monkeypatch.setattr(broadcast, "_client", None)
    c = broadcast.client()
    assert broadcast.client() is c and type(c).__name__ == "WebPubSubServiceClient"
    assert broadcast.enabled()
    asyncio.run(c.close())


def test_settings_flag():
    from app.config import Settings
    assert Settings(webpubsub_endpoint="https://x.webpubsub.azure.com", force_offline=False).webpubsub
    assert not Settings(webpubsub_endpoint="", force_offline=False).webpubsub
