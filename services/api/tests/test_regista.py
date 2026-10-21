"""Regista API tests: real data, real-result rebuilds, analytics, guardrails and the HTTP/MCP surface (offline mode)."""

from __future__ import annotations

import os

os.environ.setdefault("REGISTA_OFFLINE", "1")

import pytest
from fastapi.testclient import TestClient

from app.ai.factcheck import check
from app.ai.facts import FactSheet
from app.analytics.tactics import detect_formation
from app.analytics.xg import xg_breakdown
from app.forge.matches import build_real_match, build_what_if
from app.forge.reference import reference
from app.forge.teams import FORMATIONS
from app.main import app

FEATURED_ID = "2026-07-15-england-argentina"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------- real reference data

def test_reference_dataset_is_complete():
    s = reference().summary()
    assert s["matches"] >= 49_900
    assert s["teams"] == 337
    assert s["first_date"] == "1872-11-30"
    assert s["licence"] == "CC0-1.0"


def test_elo_ranks_elite_teams_highly():
    top10 = [t["name"] for t in reference().ranking(limit=10)]
    assert {"Spain", "Argentina", "England", "France"} <= set(top10)


def test_goal_model_favours_stronger_team():
    ref = reference()
    strong, weak = ref.expected_goals(2200, 1700, neutral=True)
    assert strong > 2 * weak


def test_head_to_head_is_real():
    h = reference().h2h("England", "Argentina", before="2026-07-15")
    assert h["played"] == 15 and h["home_wins"] == 6 and h["draws"] == 6 and h["away_wins"] == 3


# ---------------------------------------------------------------- real-result rebuilds

@pytest.mark.parametrize("date,home,away", [("2026-07-18", "France", "England"), ("2022-11-22", "Argentina", "Saudi Arabia")])
def test_rebuild_reproduces_real_goals(date, home, away):
    doc = build_real_match(date, home, away)
    real = doc["meta"]["source"]["real"]
    goals = [e for e in doc["events"] if e.get("shot_outcome") == "goal"]
    assert (doc["meta"]["final_score"]["home"], doc["meta"]["final_score"]["away"]) == (real["home_score"], real["away_score"])
    assert [g.get("own_goal_by") or g["player_name"] for g in goals] == [g["scorer"] for g in real["goals"]]
    for sim, r in zip(goals, real["goals"]):
        assert abs(sim["minute"] + (sim.get("added_minute") or 0) - r["minute"]) <= 2 or r["minute"] == 90


def test_rebuild_never_invents_cards_or_names():
    doc = build_real_match("2024-07-14", "Spain", "England")
    assert not [e for e in doc["events"] if e["type"] == "card"]
    for side in ("home", "away"):
        for p in doc["meta"][side]["players"]:
            assert p["name_source"] in ("dataset", "placeholder")
            if p["name_source"] == "placeholder":
                assert " No. " in p["name"]


def test_what_if_is_realistic():
    doc = build_what_if("england", "brazil", seed=7, max_tries=1)
    ev = doc["events"]
    passes = [e for e in ev if e["type"] == "pass"]
    shots = [e for e in ev if e["type"] == "shot"]
    assert 650 < len(passes) < 1300
    assert 12 < len(shots) < 45
    assert 0.06 < sum(e["xg"] for e in shots) / len(shots) < 0.2
    assert doc["meta"]["source"]["kind"] == "what_if"


# ---------------------------------------------------------------- analytics

def test_xg_model_is_sensible_and_explainable():
    close = xg_breakdown(99, 34)
    far = xg_breakdown(80, 34)
    header = xg_breakdown(99, 34, body_part="head")
    assert close["xg"] > 0.3 > far["xg"]
    assert header["xg"] < close["xg"]
    assert xg_breakdown(94, 34, situation="penalty")["xg"] == 0.76
    assert {f["name"] for f in close["factors"]} >= {"Distance", "Angle"}


@pytest.mark.parametrize("name", ["4-3-3", "4-2-3-1", "3-5-2", "5-3-2"])
def test_formation_templates_are_recovered(name):
    pts = [(x + 6, y) for pos, x, y in FORMATIONS[name] if pos != "GK"]
    assert detect_formation(pts)[0] == name


# ---------------------------------------------------------------- guardrails

def test_factcheck_rejects_invented_numbers_and_bias():
    fs = FactSheet()
    fs.add("xG England", 2.01)
    ok = check("England created 2.01 xG [f1].", fs)
    assert ok["passed"]
    bad = check("England created 3.7 xG [f9] thanks to his natural athlete instincts.", fs)
    assert not bad["passed"]
    problems = " ".join(i["problem"] for i in bad["issues"])
    assert "3.7" in problems and "[f9]" in problems
    assert bad["bias_flags"]


# ---------------------------------------------------------------- HTTP + MCP surface

def test_health_and_matches(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and h["mode"] == "offline"
    matches = client.get("/api/matches").json()
    assert any(m["match_id"] == FEATURED_ID for m in matches)
    assert all(m["source"]["kind"] in ("real_result", "what_if") for m in matches)


def test_analysis_and_moment_detail(client):
    a = client.get(f"/api/matches/{FEATURED_ID}/analysis").json()
    assert a["score"] == {"home": 1, "away": 2}
    goals = [m for m in a["moments"] if m["type"] == "goal"]
    assert len(goals) == 3
    d = client.get(f"/api/matches/{FEATURED_ID}/moments/{goals[-1]['id']}").json()
    assert d["freeze_frame"] and d["xg_breakdown"]["factors"]


def test_narrative_is_grounded(client):
    a = client.get(f"/api/matches/{FEATURED_ID}/analysis").json()
    goal = next(m for m in a["moments"] if m["type"] == "goal")
    for persona in ("casual", "analyst", "kids", "accessible"):
        n = client.post("/api/narrate", json={"match_id": FEATURED_ID, "scope": "moment", "moment_id": goal["id"], "persona": persona}).json()
        assert n["fact_check"]["passed"], n["fact_check"]
        assert n["citations"]


def test_recap_and_ask(client):
    r = client.post("/api/recap", json={"match_id": FEATURED_ID}).json()
    assert r["headline"] and r["run_sheet"] and r["player_of_match"]
    assert r["fact_check"]["passed"]
    q = client.post("/api/ask", json={"match_id": FEATURED_ID, "question": "Why did England concede the second?"}).json()
    assert "Martínez" in q["answer"] and q["tool_calls"]


def test_studio_flow(client):
    items = client.get(f"/api/studio/{FEATURED_ID}/queue").json()
    assert any(i["kind"] == "lower_third" for i in items)
    item = client.post(f"/api/studio/{FEATURED_ID}/items/{items[0]['id']}", json={"action": "approve"}).json()
    assert item["status"] == "approved"


def test_mcp_lists_tools(client):
    headers = {"accept": "application/json, text/event-stream", "content-type": "application/json"}
    client.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                                "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}})
    r = client.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    names = {t["name"] for t in r.json()["result"]["tools"]}
    assert {"get_match_state", "explain_moment", "get_head_to_head", "get_player_dna", "get_dugout_advice"} <= names


def test_speech_returns_501_offline(client):
    assert client.post("/api/speech", json={"text": "Goal!", "language": "en"}).status_code == 501


# ---------------------------------------------------------------- manager & scouting

def test_lineups_use_known_positions():
    doc = build_real_match("2026-07-18", "France", "England")
    eng = {p["name"]: p["position"] for p in doc["meta"]["away"]["players"] if p["starter"]}
    assert eng.get("Harry Kane") == "ST" and eng.get("Bukayo Saka") == "RW" and eng.get("Jude Bellingham") == "AM"


def test_penalties_carry_placement_and_dive():
    doc = build_real_match("2026-07-05", "Mexico", "England")
    pens = [e for e in doc["events"] if e.get("situation") == "penalty"]
    assert pens and all(e["placement"] in ("left", "center", "right") and e["gk_dive"] in ("left", "center", "right") for e in pens)
    assert doc["meta"]["venue_info"]["altitude_m"] == 2240 and doc["meta"]["venue_info"]["acclimatised"] == ["mexico"]


def test_altitude_tires_visitors_more():
    from app.forge import physical
    doc = build_real_match("2026-07-05", "Mexico", "England")
    end = doc["events"][-1]["t"]
    u = physical.upto(doc["physical"], doc["meta"], end, end)
    team = {p["player_id"]: p["team_id"] for s in ("home", "away") for p in doc["meta"][s]["players"] if p["position"] != "GK"}

    def avg_drop(tid):
        vals = [v["drop_pct"] for pid, v in u.items() if team.get(pid) == tid and v["minutes"] >= 80]
        return sum(vals) / len(vals)
    assert avg_drop("england") > avg_drop("mexico")


def test_player_dna_real_and_model(client):
    d = client.get("/api/scouting/players/england:harry-kane").json()
    assert d["real"]["international_goals"] >= 70 and d["real"]["penalty_goals"] >= 20
    assert d["model"]["foot"]["right"] > d["model"]["foot"]["left"]
    assert d["model"]["penalties"]["real_scored"] == d["real"]["penalty_goals"]
    assert d["how_to_stop"]
    haaland = client.get("/api/scouting/players/norway:erling-haaland").json()
    assert haaland["model"]["foot"]["left"] > haaland["model"]["foot"]["right"]          # publicly known left-footer
    assert haaland["model"]["per90"]["interceptions"] < 2.5                              # strikers rarely intercept


def test_team_report(client):
    r = client.get("/api/scouting/teams/argentina").json()
    assert r["real"]["home"]["played"] > 0 and r["model"]["leaders"]["most_distance"]
    assert r["how_to_play_against"]


def test_dugout_recommends_when_chasing(client):
    d = client.get("/api/matches/2022-11-22-argentina-saudi-arabia/dugout", params={"side": "home", "upto_t": 4300}).json()
    assert d["score"] == {"home": 1, "away": 2}
    subs = [r for r in d["recommendations"] if r["type"] == "substitution"]
    assert subs and subs[0]["substitution"]["impact"]["wp_after"]["home"] >= subs[0]["substitution"]["impact"]["wp_before"]["home"]
    b = client.post("/api/dugout/brief", json={"match_id": "2022-11-22-argentina-saudi-arabia", "side": "home", "upto_t": 4300}).json()
    assert b["fact_check"]["passed"] and b["text"]


def test_physical_endpoint(client):
    rows = client.get("/api/matches/2026-07-15-england-argentina/physical").json()["players"]
    outfield = [r for r in rows if r["position"] != "GK" and r["minutes"] >= 85]
    assert all(8 < r["distance_km"] < 14.5 for r in outfield)


# ---------------------------------------------------------------- truth loop, brief features, governance, ops

HERO = "2026-07-15-england-argentina"


def test_truth_mode_grades_planted_changes(client):
    assert any(m["planted_changes"] for m in client.get("/api/matches").json())
    meta = client.get(f"/api/matches/{HERO}").json()
    assert "truth" not in meta                                   # hidden from normal endpoints
    t = client.get(f"/api/matches/{HERO}/truth").json()
    assert {p["mechanism"] for p in t["plants"]} == {"press_switch", "tiring_fullback"}
    assert t["score"]["recall"] == 1.0 and t["score"]["explanation_accuracy"] == 1.0
    assert all(g["seconds_to_detect"] < 600 for g in t["grades"])
    ins = t["insights"][0]
    assert ins["feature"]["series"] and "series_fit_2lines" in ins["feature"]["query"] or ins["feature"]["query"]


def test_truth_is_live_honest(client):
    early = client.get(f"/api/matches/{HERO}/truth", params={"upto_t": 50 * 60}).json()
    assert all(g.get("pending") for g in early["grades"])          # plants not reached yet are pending, not missed
    assert not [i for i in early["insights"] if i["mechanism"] == "press_switch" and i["team_id"] == "argentina"]


def test_counterfactual_measures_the_change(client):
    r = client.post(f"/api/matches/{HERO}/counterfactual", json={"plant_id": "eng-arg-press", "runs": 6}).json()
    assert r["runs"] == 6 and r["with_change"]["median"] >= r["without_change"]["median"]
    assert "paired re-runs" in r["explanation"]


def test_verifier_drill_catches_planted_claim_error(client):
    ins = next(i for i in client.get(f"/api/matches/{HERO}/insights").json() if i["mechanism"] == "press_switch")
    r = client.post(f"/api/matches/{HERO}/insights/{ins['id']}/narrate", json={"drill": True}).json()
    v = r["verification"]
    assert v["drill"] and v["caught"] and v["planted"]["planted"] in v["draft"]
    assert v["planted"]["planted"] not in r["text"] and r["fact_check"]["passed"]   # the overstated number never airs
    assert any(t["agent"] == "Verifier drill" for t in r["agent_trace"])
    clean = client.post(f"/api/matches/{HERO}/insights/{ins['id']}/narrate", json={}).json()
    assert clean["verification"] is None and clean["text"] == r["text"]


def test_plant_error_overstates_the_headline_number():
    import random

    from app.ai.factcheck import plant_error
    fs = FactSheet()
    fs.add("Regains before", 0.27)
    fs.add("Regains after", 0.82)
    p = plant_error("Regains went from 0.27 to 0.82 from 64'.", fs, random.Random(1))
    assert p["original"] == "0.82" and float(p["planted"]) > 0.82 and "64'" in p["text"]
    assert any(i["problem"] == p["problem"] for i in check(p["text"], fs)["issues"])
    assert plant_error("England pressed higher from 64'.", fs, random.Random(1)) is None


def test_event_detail_and_control_chaos(client):
    ev = client.get(f"/api/matches/{HERO}/events", params={"types": "pass,carry,shot"}).json()
    passes = [e for e in ev if e["type"] == "pass"]
    assert all("pass_length" in e and "ball_speed_kmh" in e for e in passes)
    assert any("difficulty" in e for e in passes)
    assert any("sprint" in (e.get("tags") or []) for e in ev if e["type"] == "carry")
    assert all(30 <= e["shot_speed_kmh"] <= 128 for e in ev if e["type"] == "shot")
    a = client.get(f"/api/matches/{HERO}/analysis").json()
    assert a["control_chaos"] and 0 <= a["control_chaos"][-1]["value"] <= 1
    assert a["pass_profile"]["home"]["completion_by_difficulty"]


def test_control_room_governance(client):
    mid = "2024-07-14-spain-england"
    client.post(f"/api/studio/{mid}/settings", json={"profile_id": "uk-multi", "auto_approve_threshold": 70})
    items = client.get(f"/api/studio/{mid}/queue").json()
    assert all(i["cue"]["version"] == "1.0" and "en" in i["cue"]["strings"] for i in items)
    assert any(i.get("auto_approved") for i in items)
    target = items[0]["id"]
    client.post(f"/api/studio/{mid}/items/{target}", json={"action": "on_air"})
    killed = client.post(f"/api/studio/{mid}/items/{target}", json={"action": "kill"}).json()
    assert killed["status"] == "killed"
    audit = client.get(f"/api/studio/{mid}/audit").json()
    assert {"kill", "on_air"} <= {a["action"] for a in audit} and any(a["by"] == "auto" for a in audit)


def test_producer_adds_halftime_graphic(client):
    mid = "2024-07-14-spain-england"
    body = {"kind": "stat_card", "title": "First-half xG", "body": "Spain 1.10 · England 0.40", "t": 2700, "key": "ht-xg",
            "template": "ht_xg", "data": {"home": 1.1, "away": 0.4}}
    item = client.post(f"/api/studio/{mid}/items", json=body).json()
    assert item["status"] == "proposed" and item["cue"]["version"] == "1.0" and item["cue"]["template"] == "ht_xg"
    assert client.post(f"/api/studio/{mid}/items", json=body).json()["id"] == item["id"]      # idempotent on key
    assert item["id"] in {i["id"] for i in client.get(f"/api/studio/{mid}/queue").json()}
    assert any(a["item_id"] == item["id"] and a["by"] == "producer" for a in client.get(f"/api/studio/{mid}/audit").json())
    blocked = client.post(f"/api/studio/{mid}/items", json={"kind": "lower_third", "title": "Odds shorten", "body": "Bookies favour Spain"}).json()
    assert client.post(f"/api/studio/{mid}/items/{blocked['id']}", json={"action": "on_air"}).status_code == 409


def test_editorial_rules_block_betting_language():
    from app.ai.producer import editorial
    assert not editorial({"title": "Odds shorten", "body": "Bookies favour England"})["passed"]
    assert editorial({"title": "Win probability swing", "body": "England 41% to 63%"})["passed"]


def test_ops_endpoint(client):
    o = client.get("/api/ops").json()
    assert o["slo"]["target_p95_ms"] > 0 and "price_note" in o["cost"]


def test_video_safe_scrub():
    from app.brand_safe import scrub
    assert scrub("FIFA World Cup semi-final, UEFA Euro final") == "World tournament semi-final, European championship final"


def test_season_generator_small():
    from app.forge.season import generate
    docs, summary = generate(n_teams=3, plant_share=1.0, seed=7)
    assert summary["matches"] == 6 and summary["planted_changes"] >= 6 and len(summary["standings"]) == 3
