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


def test_translate_rejects_oversized_or_malformed_requests(client):
    assert client.post("/api/translate", json={"texts": ["x"] * 101, "to": "es"}).status_code == 422
    assert client.post("/api/translate", json={"texts": ["x" * 2001], "to": "es"}).status_code == 422
    assert client.post("/api/translate", json={"texts": ["Hi"], "to": "es&x=1"}).status_code == 422
    assert client.post("/api/translate", json={"texts": ["Hi"], "to": "zh-Hans"}).status_code == 200


def test_search_real_results_and_replay_one(client):
    rows = client.get("/api/forge/real", params={"team": "argentina", "opponent": "england", "year": 1986}).json()
    assert [(r["date"], r["home_score"], r["away_score"], r["replayable"]) for r in rows] == [("1986-06-22", 2, 1, True)]
    mid = rows[0]["match_id"]
    summary = client.post("/api/forge/real", json={"match_id": mid}).json()
    assert summary["match_id"] == mid and summary["rebuilt"] and summary["source"]["kind"] == "real_result"
    assert summary["final_score"] == {"home": 2, "away": 1}
    events = client.get(f"/api/matches/{mid}/events").json()
    scorers = [e["player_name"] for e in events if e["type"] == "shot" and e["outcome"] == "success"]
    assert scorers == ["Diego Maradona", "Diego Maradona", "Gary Lineker"]          # the real scorers, in order
    assert client.post("/api/forge/real", json={"match_id": mid}).json()["match_id"] == mid   # already built: returned


def test_every_real_result_can_be_replayed_and_bad_ids_are_refused(client):
    rows = client.get("/api/forge/real", params={"team": "argentina", "year": 2026}).json()
    assert rows and all(r["replayable"] and r["reason"] is None for r in rows)      # extra time and shoot-outs included
    assert client.post("/api/forge/real", json={"match_id": "1900-01-01-nowhere-nobody"}).status_code == 404
    assert client.post("/api/forge/real", json={"match_id": "../etc"}).status_code == 422
    assert client.get("/api/forge/real", params={"team": "atlantis"}).status_code == 404


def test_rebuilt_replays_are_capped(client):
    from app.api.deps import get_store
    from app.forge.reference import reference
    store, ref = get_store(), reference()
    featured = {m for m, d in store.docs.items() if d["meta"].get("featured")}
    ids = [r["match_id"] for r in ref.search_results("brazil", limit=100) if r["replayable"] and r["match_id"] not in featured][:4]
    for mid in ids:
        assert client.post("/api/forge/real", json={"match_id": mid}).status_code == 200
    store.add_rebuilt(store.get(ids[-1]), keep=2)
    assert sum(1 for d in store.docs.values() if d["meta"].get("rebuilt")) == 2


def test_live_stream_max_gap_is_bounded(client):
    from conftest import HERO
    assert client.get(f"/api/matches/{HERO}/live", params={"max_gap": 50}).status_code == 422
    assert client.get(f"/api/matches/{HERO}/live", params={"max_gap": 0}).status_code == 422


def test_replay_models_goals_the_dataset_does_not_record_and_names_nobody(client):
    rows = client.get("/api/forge/real", params={"team": "pakistan", "opponent": "afghanistan", "year": 2015}).json()
    assert rows[0]["replayable"] and rows[0]["goals_modelled"]
    summary = client.post("/api/forge/real", json={"match_id": rows[0]["match_id"]}).json()
    assert summary["final_score"] == {"home": 2, "away": 1}                              # the real score stands
    assert summary["source"]["goals_modelled"] is True
    match = client.get(f"/api/matches/{rows[0]['match_id']}").json()
    assert match["source"]["real"]["goals"] == []                                        # no modelled goal is passed off as real
    names = [p["name"] for side in ("home", "away") for p in match[side]["players"]]
    assert all(" No. " in n for n in names)                                              # nobody is named
    assert "doesn't record this match's goalscorers" in match["source"]["disclosure"]


def test_replay_uses_cited_match_reports_when_the_dataset_has_no_scorers_yet(client):
    rows = client.get("/api/forge/real", params={"team": "spain", "opponent": "england", "year": 2026}).json()
    game = next(r for r in rows if r["date"] == "2026-09-26")
    assert game["replayable"] and not game["goals_modelled"]
    client.post("/api/forge/real", json={"match_id": game["match_id"]})
    match = client.get(f"/api/matches/{game['match_id']}").json()
    assert match["source"]["goals_modelled"] is False
    assert all(u.startswith("https://") for u in match["source"]["scorers_sources"])
    goals = [(g["minute"], g["scorer"]) for g in match["source"]["real"]["goals"]]
    assert goals == [(2, "Lamine Yamal"), (36, "Anthony Gordon"), (40, "Harry Kane"), (60, "Álex Baena"), (74, "Mikel Oyarzabal")]
    assert "published match reports" in match["source"]["disclosure"]


def test_supplement_never_overrides_the_dataset_or_contradicts_the_score(tmp_path):
    from collections import defaultdict

    from app.forge.reference import ReferenceData
    ref = object.__new__(ReferenceData)
    ref.former, ref.goal_rows, ref.scorer_sources = {}, [], {}
    ref.results = [{"date": "2026-10-01", "home_team": "A", "away_team": "B", "home_score": 1, "away_score": 0},
                   {"date": "2026-10-02", "home_team": "A", "away_team": "C", "home_score": 2, "away_score": 0},
                   {"date": "2026-10-03", "home_team": "B", "away_team": "C", "home_score": 1, "away_score": 1}]
    ref.goals = defaultdict(list, {("2026-10-03", "B", "C"): [{"scorer": "In CC0"}, {"scorer": "In CC0"}]})
    f = tmp_path / "goalscorers_supplement.csv"
    f.write_text("date,home_team,away_team,team,scorer,minute,own_goal,penalty,assist,source\n"
                 "2026-10-01,A,B,A,Right,10,FALSE,FALSE,NA,https://a\n"            # adds up: kept
                 "2026-10-02,A,C,A,Short,10,FALSE,FALSE,NA,https://b\n"            # one of two goals: skipped
                 "2026-10-03,B,C,B,Other,10,FALSE,FALSE,NA,https://c\n"            # CC0 already has it: skipped
                 "2026-10-03,B,C,C,Other,20,FALSE,FALSE,NA,https://c\n", encoding="utf-8")
    ref._load_supplement(f)
    assert ref.scorer_sources == {("2026-10-01", "A", "B"): ["https://a"]}
    assert [g["scorer"] for g in ref.goals[("2026-10-03", "B", "C")]] == ["In CC0", "In CC0"]
    assert ("2026-10-02", "A", "C") not in ref.goals


def test_extra_time_and_shootouts_replay_with_the_real_winner(client):
    rows = client.get("/api/forge/real", params={"team": "argentina", "opponent": "france", "year": 2022}).json()
    final = next(r for r in rows if r["date"] == "2022-12-18")
    assert final["replayable"] and final["shootout_winner"] == "Argentina"
    summary = client.post("/api/forge/real", json={"match_id": final["match_id"]}).json()
    assert summary["final_score"] == {"home": 3, "away": 3} and summary["extra_time"] is True
    match = client.get(f"/api/matches/{final['match_id']}").json()
    assert len(match["period_starts"]) == 4                                              # two halves and two of extra time
    so = match["shootout"]
    assert so["winner"] == "home" and so["home"] > so["away"] and so["modelled"] is True   # the real winner
    assert "shoot-out is modelled" in match["source"]["disclosure"]
    events = client.get(f"/api/matches/{final['match_id']}/events").json()
    assert events[-1]["type"] == "full_time" and events[-1]["minute"] >= 120
    late = [e for e in events if e["type"] == "shot" and e["outcome"] == "success" and e["minute"] > 105]
    assert [e["player_name"] for e in late] == ["Lionel Messi", "Kylian Mbappé"]           # the real extra-time goals
