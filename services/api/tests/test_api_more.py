"""HTTP surface: error paths, Azure-only endpoints (speech, translate) and the Event Hubs start-up branch."""

from __future__ import annotations

import pytest
from conftest import HERO
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(loaded_store):
    """No lifespan here: the MCP session manager may only start once per process (test_regista's client does that)."""
    from app.main import app
    return TestClient(app)


@pytest.mark.parametrize("path", [
    "/api/matches/nope/analysis",
    "/api/reference/teams/atlantis",
    "/api/reference/h2h?a=atlantis&b=england",
    f"/api/matches/{HERO}/moments/nope",
    "/api/scouting/players/nobody:nobody",
    "/api/scouting/teams/atlantis",
])
def test_not_found(client, path):
    assert client.get(path).status_code == 404


def test_moment_detail_and_players(client):
    goal = next(m for m in client.get(f"/api/matches/{HERO}/analysis").json()["moments"] if m["type"] == "goal")
    d = client.get(f"/api/matches/{HERO}/moments/{goal['id']}").json()
    assert d["moment"]["id"] == goal["id"] and d["sequence"] and d["xg_breakdown"]["xg"] > 0
    rows = client.get(f"/api/matches/{HERO}/players", params={"upto_t": 3000}).json()
    assert rows and all("rating" in r for r in rows)


def test_narrate_and_studio_errors(client):
    assert client.post("/api/narrate", json={"match_id": HERO, "scope": "moment", "moment_id": "nope"}).status_code == 404
    assert client.post(f"/api/studio/{HERO}/items/nope", json={"action": "approve"}).status_code == 404
    assert client.post(f"/api/studio/{HERO}/settings", json={"profile_id": "nope"}).status_code == 404
    assert client.post(f"/api/matches/{HERO}/insights/nope/narrate", json={}).status_code == 404
    assert client.post(f"/api/matches/{HERO}/counterfactual", json={"plant_id": "nope", "runs": 4}).status_code == 404
    assert client.post("/api/forge/generate", json={"home_team_id": "atlantis", "away_team_id": "england"}).status_code == 400
    assert client.get("/api/studio/profiles").json()[0]["id"] == "global-en"
    assert client.get(f"/api/studio/{HERO}/settings").json()["profile_id"]


def test_studio_approve_translates_multi_language_cue(client, monkeypatch):
    from app.ai import producer
    mid = "2024-07-10-netherlands-england"
    client.post(f"/api/studio/{mid}/settings", json={"profile_id": "uk-multi", "clear_threshold": True})
    called = []

    async def fake_translate_cue(item):
        called.append(item["id"])
        return item

    monkeypatch.setattr(producer, "translate_cue", fake_translate_cue)
    item = client.get(f"/api/studio/{mid}/queue").json()[0]
    r = client.post(f"/api/studio/{mid}/items/{item['id']}", json={"action": "approve"}).json()
    assert r["status"] == "approved" and called == [item["id"]]


def test_speech_endpoint(client, azure, monkeypatch):
    from app.api.deps import get_synthesizer
    overrides = client.app.dependency_overrides
    assert client.post("/api/speech", json={"text": "Goal"}).status_code == 501
    azure()

    async def synth(text, language, persona):
        return b"ID3-fake-mp3"

    monkeypatch.setitem(overrides, get_synthesizer, lambda: synth)
    r = client.post("/api/speech", json={"text": "Goal for England", "language": "en", "persona": "kids"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3-fake-mp3"

    async def broken(text, language, persona):
        raise RuntimeError("speech down")

    monkeypatch.setitem(overrides, get_synthesizer, lambda: broken)
    assert client.post("/api/speech", json={"text": "Another line"}).status_code == 502


def test_translate_endpoint(client, azure, monkeypatch):
    from app.api.deps import get_translator
    overrides = client.app.dependency_overrides
    assert client.post("/api/translate", json={"texts": ["Hi"], "to": "es"}).json()["engine"] == "offline"
    azure()

    async def tr(texts, to):
        return [f"{t} ({to})" for t in texts]

    monkeypatch.setitem(overrides, get_translator, lambda: tr)
    assert client.post("/api/translate", json={"texts": ["Hi"], "to": "es"}).json() == {"texts": ["Hi (es)"], "engine": "azure"}
    assert client.post("/api/translate", json={"texts": ["Hi"], "to": "en"}).json()["engine"] == "offline"

    async def broken(texts, to):
        raise RuntimeError("down")

    monkeypatch.setitem(overrides, get_translator, lambda: broken)
    assert client.post("/api/translate", json={"texts": ["Hi"], "to": "fr"}).json() == {"texts": ["Hi"], "engine": "offline"}


def test_truth_score_without_files(client, tmp_path, monkeypatch):
    from app.forge import reference
    monkeypatch.setattr(reference, "REPO_ROOT", tmp_path)
    assert client.get("/api/truth/score").json() == {"latest": None, "history": []}


def test_forge_teams_and_scenario(client):
    teams = client.get("/api/forge/teams", params={"limit": 2}).json()
    assert len(teams) == 2 and teams[0]["rank"] == 1
    r = client.post("/api/forge/scenario", json={"prompt": "Spain v Germany, a tactical chess match"}).json()
    assert r["config"]["scenario"] == "tactical_chess" and r["engine"] == "offline"


def test_startup_with_eventhub_consumer(azure, monkeypatch):
    import asyncio

    from app import main
    from app.live import eventhub
    azure(live_source="eventhub", eventhub_fqdn="ns.servicebus.windows.net")
    started = []

    async def consume():
        started.append(True)
        await asyncio.sleep(3600)

    monkeypatch.setattr(eventhub, "consume_forever", consume)

    class Once:
        def run(self):
            import contextlib

            @contextlib.asynccontextmanager
            async def cm():
                yield
            return cm()

    import types
    monkeypatch.setattr(main, "mcp", types.SimpleNamespace(session_manager=Once()))
    with TestClient(main.app) as c:
        h = c.get("/api/health").json()
        assert h["services"]["eventhub"] and h["live"]["source"] == "eventhub" and h["mode"] == "azure"
    assert started


def test_mcp_tools_are_registered():
    import asyncio

    from app.mcp_server import mcp
    tools = asyncio.run(mcp.list_tools())
    assert len(tools) == 14 and {"get_match_state", "get_player_dna", "get_dugout_advice"} <= {t.name for t in tools}
