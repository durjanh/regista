"""Forge, analytics and tool corners: xT fitting, the engine goal model, the season generator, counterfactuals,
offline commentary, MCP tools and the video-safe middleware."""

from __future__ import annotations

import asyncio
import json
import sys

import pytest
from conftest import HERO


def test_xt_fit_save_load(loaded_store, tmp_path):
    from app.analytics import xt
    grid = xt.fit_xt([loaded_store.get(HERO)], iterations=3)
    assert len(grid) == xt.NX and len(grid[0]) == xt.NY
    assert max(max(c) for c in grid) > 0 and grid[-1][xt.NY // 2] >= grid[0][xt.NY // 2]   # threat grows towards goal
    p = tmp_path / "xt.json"
    xt.save(grid, p)
    assert xt.load(p) == grid and xt.load(tmp_path / "missing.json") is None
    p.write_text(json.dumps({"nx": 1, "ny": 1, "grid": [[0]]}))
    assert xt.load(p) is None


def test_engine_goal_model_fit_and_cache(loaded_store, tmp_path, monkeypatch):
    from app.forge import matches
    monkeypatch.setattr(matches, "_engine_model", None)
    monkeypatch.setattr(matches, "ENGINE_MODEL_PATH", tmp_path / "engine.json")
    model = matches.engine_goal_model(n=24)
    assert model["n"] == 24 and len(model["home"]) == 2 and (tmp_path / "engine.json").exists()
    assert matches.engine_goal_model() is model
    monkeypatch.setattr(matches, "_engine_model", None)
    assert matches.engine_goal_model()["n"] == 24                         # reloaded from disk
    intercept, slope = matches._fit_log_linear([(d, 1 + (d > 0)) for d in range(-400, 401, 10) for _ in range(3)])
    assert slope > 0


def test_season_generate_write_and_cli(loaded_store, tmp_path, monkeypatch, capsys):
    import random

    from app.forge import season
    plants = season.random_plants(random.Random(3))
    assert 1 <= len(plants) <= 2 and all(p["mechanism"] in season.MECHANISMS for p in plants)
    docs, summary = season.generate(n_teams=3, plant_share=1.0, seed=11)
    assert summary["matches"] == 6 and summary["planted_changes"] >= 6 and len(summary["standings"]) == 3
    assert sum(r["P"] for r in summary["standings"]) == 12
    season.write(docs, summary, tmp_path / "s")
    lines = (tmp_path / "s" / "events.jsonl").read_text().splitlines()
    assert len((tmp_path / "s" / "matches.jsonl").read_text().splitlines()) == 6 and "freeze_frame" not in lines[0]
    with pytest.raises(SystemExit):
        season.write(docs, summary, tmp_path / "s2", upload=True)       # OneLake not configured

    uploaded = []

    async def fake_onelake(path, data):
        uploaded.append(path)

    from conftest import FakeResult  # noqa: F401  (conftest import keeps the fixture module loaded)

    from app.integrations import persistence
    monkeypatch.setattr(persistence, "_onelake", fake_onelake)
    monkeypatch.setattr(season, "generate", lambda n, p, s: (docs, summary))
    import dataclasses

    from app import config
    monkeypatch.setattr(config, "settings", dataclasses.replace(config.settings, onelake_workspace="ws", onelake_lakehouse="lh"))
    monkeypatch.setattr(sys, "argv", ["season", "--teams", "3", "--out", str(tmp_path / "cli"), "--upload"])
    season.main()
    out = json.loads(capsys.readouterr().out)
    assert out["matches"] == 6 and "in range" in out["realism"] and len(uploaded) == 4


def test_counterfactual_what_if_and_metrics(loaded_store):
    from app.analytics import counterfactual
    from app.forge.matches import build_what_if
    plants = [{"id": "p1", "mechanism": "chaos_spell", "side": "both", "minute": 30, "duration": 9, "difficulty": "obvious", "description": "chaos"},
              {"id": "p2", "mechanism": "set_piece_routine", "side": "home", "minute": 20, "difficulty": "obvious", "description": "corners"}]
    doc = build_what_if("spain", "germany", seed=4, max_tries=1, plants=plants)
    r = counterfactual.run(doc, "p1", runs=4)
    assert r["runs"] == 4 and r["metric"]["name"] == "flips" and "paired re-runs" in r["explanation"]
    r2 = counterfactual.run(doc, "p2", runs=4)
    assert r2["metric"]["unit"] == "xG"
    with pytest.raises(KeyError):
        counterfactual.run(doc, "nope", runs=4)
    assert counterfactual._q([]) == {"median": 0.0, "p10": 0.0, "p90": 0.0}
    for mech in ("shape_change", "hot_streak", "tiring_fullback"):
        assert counterfactual._metric(doc, {"mechanism": mech, "team_id": doc["meta"]["home"]["team_id"], "t": 1800.0, "player_id": "x"}) >= 0


def test_offline_moment_texts_every_type_and_persona(loaded_store):
    from app.ai.facts import moment_sheet
    from app.ai.offline import headline, live_line, moment_text
    an = loaded_store.analyzer(HERO)
    a = an.analyze()
    seen = set()
    for m in a["moments"]:
        for p in ("casual", "analyst", "kids", "fantasy", "broadcaster", "social", "accessible"):
            text = moment_text(m, an.meta, p, moment_sheet(an.meta, a, m))
            assert text and m["summary"].split(" ")[0] in text or text
            seen.add(m["type"])
    assert {"goal"} <= seen
    lines = [live_line(e, an.meta) for e in an.events]
    assert any(line and line.startswith("GOAL!") for line in lines) and any(line == "Corner to England." or line == "Corner to Argentina." for line in lines)
    for out in ("saved", "off_target", "blocked", "post", "weird"):
        assert live_line({"type": "shot", "shot_outcome": out, "player_name": "X", "team_id": an.meta["home"]["team_id"]}, an.meta)
    for t, extra in (("card", {"card": "red"}), ("card", {"card": "yellow"}), ("substitution", {}), ("offside", {}),
                     ("foul", {"tags": ["penalty_conceded"]}), ("pass", {})):
        live_line({"type": t, "player_name": "X", "team_id": an.meta["home"]["team_id"], **extra}, an.meta)
    meta = dict(an.meta)
    for hint, score in (("Giant-killing", {"home": 2, "away": 1}), ("The comeback", {"home": 1, "away": 2}), ("Late drama", {"home": 1, "away": 0}),
                        ("Goal fest", {"home": 4, "away": 3}), ("", {"home": 3, "away": 0}), ("", {"home": 1, "away": 1})):
        meta["headline_hint"] = hint
        assert headline(meta, {"score": score})


def test_tools_cover_every_branch(loaded_store):
    from app.ai import tools
    mid = HERO
    assert any(m["match_id"] == mid for m in tools.list_matches())
    assert tools.get_match_state(mid, minute=30)["minute"] in (30, 31)
    moments = tools.get_key_moments(mid, minute=None, min_importance=0)
    goal = next(m for m in moments if m["type"] == "goal")
    assert "xg_breakdown" in tools.explain_moment(mid, goal["moment_id"]) and "error" in tools.explain_moment(mid, "nope")
    assert tools.get_player_stats(mid, "Messi").get("name") and "error" in tools.get_player_stats(mid, "Nobody Atall")
    both = tools.get_tactical_summary(mid)
    one = tools.get_tactical_summary(mid, team="England")
    assert len(both) == 2 and list(one) == ["England"]
    assert "error" in tools.get_xg_breakdown(mid, "nope")
    assert "England" in tools.compare_periods(mid, 1, 45)
    assert tools.get_head_to_head("England", "Argentina", "2026-01-01")["played"] > 0
    assert len(tools.get_team_history("England")["elo_history"]) <= 12
    assert tools.get_player_dna("Lionel Messi")["name"] == "Lionel Messi"
    assert "error" in tools.get_player_dna("Zzzz Nobody") and tools.get_player_dna("messi")["name"]
    assert tools.get_team_report("Argentina")
    adv = tools.get_dugout_advice(mid, "home", minute=70)
    assert "recommendations" in adv and all(set(p) == {"name", "position", "rating", "baseline", "status", "reasons"} for p in adv["players"])
    gen = tools.generate_what_if("Spain", "Portugal", "late_drama")
    assert gen["match_id"] in loaded_store.docs
    assert tools.call_tool("nope", {}) == {"error": "unknown tool nope"}
    assert "error" in tools.call_tool("get_match_state", {"match_id": "missing"})
    specs = {s["function"]["name"]: s for s in tools.openai_tool_specs()}
    assert specs["get_match_state"]["function"]["parameters"]["properties"]["minute"]["type"] == "integer"
    assert "generate_what_if" not in specs


def test_mcp_resource_lists_matches(loaded_store):
    from app import mcp_server
    data = json.loads(mcp_server.matches_resource())
    assert any(m["match_id"] == HERO for m in data)


def test_video_safe_middleware_scrubs_json(loaded_store, monkeypatch):
    from fastapi.testclient import TestClient

    from app import brand_safe
    from app.main import app
    monkeypatch.setattr(brand_safe, "ENABLED", True)
    body = TestClient(app).get(f"/api/matches/{HERO}").text
    assert "FIFA" not in body and "World tournament" in body
    assert TestClient(app).get("/openapi.json").status_code == 200


def test_eval_grounding_and_drill_offline(loaded_store):
    from app.evals import run
    g = run.grounding_offline()
    assert g["pass_rate"] == 1.0 and g["bias_flags"] == 0
    d = run.verifier_drill()
    assert d["catch_rate"] == 1.0 and d["drafts"] > 100


def test_grounding_offline_reports_failures(loaded_store, monkeypatch):
    from app.ai import offline
    from app.evals import run
    monkeypatch.setattr(offline, "moment_text", lambda m, meta, p, fs: "An invented 99.99 number.")
    real = offline.recap

    def bad_recap(meta, a, fs, p):
        out = real(meta, a, fs, p)
        out["report_md"] += " Another invented 77.77."
        return out

    monkeypatch.setattr(offline, "recap", bad_recap)
    g = run.grounding_offline()
    assert g["pass_rate"] == 0.0 and g["failures"] and g["failures"][0]["issues"]


def test_judge_uses_azure_evaluation_when_available(monkeypatch):
    import types

    from app.evals import run

    class Evaluator:
        def __init__(self, model_config):
            self.cfg = model_config

        def __call__(self, response, context):
            return {"groundedness": 4.0}

    monkeypatch.setitem(sys.modules, "azure.ai.evaluation", types.SimpleNamespace(GroundednessEvaluator=Evaluator))
    out = asyncio.run(run._judge([{"text": "x", "citations": []}, {"report_md": "y"}]))
    assert out == {"evaluator": "azure-ai-evaluation GroundednessEvaluator", "mean": 4.0}
