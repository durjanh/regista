"""The CI evaluation runner and the live SSE engine (replay, Event Hubs source, overlay)."""

from __future__ import annotations

import asyncio
import json
import sys

import pytest
from conftest import HERO


@pytest.fixture
def repo_tmp(tmp_path, monkeypatch):
    from app.forge import reference
    (tmp_path / "data" / "reference").mkdir(parents=True)
    (tmp_path / "docs").mkdir()
    monkeypatch.setattr(reference, "REPO_ROOT", tmp_path)
    return tmp_path


# ---------------------------------------------------------------- evals


def test_eval_components_small(loaded_store):
    from app.evals import run
    f = run.fidelity()
    assert f["fidelity"] == 1.0 and f["matches"] == len(run.FEATURED)
    t = run.tactical_detection(n_whatif=1)
    assert t["matches"] == len(run.FEATURED) + 1 and 0 <= t["precision"] <= 1
    s = run.scouting_accuracy()
    assert s["foot"]["accuracy"] >= 0.85
    tr = run.truth_suite(n=4, seed=77)
    assert tr["matches"] == 4 and tr["control_matches"] == 1 and len(tr["by_difficulty"]) == 3
    c = run.calibration(n=12)
    assert c["metrics_total"] >= 10 and "brier" in c


def test_record_truth_appends_history_and_draws_svg(repo_tmp):
    from app.evals import run
    result = {"date": "2026-10-21", "recall": 0.4, "false_alarms_per_match": 0.9, "median_seconds_to_detect": 500}
    run.record_truth(result)
    run.record_truth({**result, "recall": 0.5})
    hist = json.loads((repo_tmp / "data" / "reference" / "truth-score-history.json").read_text())
    assert [h["recall"] for h in hist] == [0.4, 0.5]
    svg = (repo_tmp / "docs" / "truth-score.svg").read_text()
    assert svg.startswith("<svg") and "recall 0.5" in svg


def test_grounding_azure_and_llm_judge(loaded_store, monkeypatch):
    from app.ai import clients, narrator, recap
    from app.evals import run

    async def narrate(mid, scope, persona, lang, moment_id=None):
        return {"text": "ok [f1]", "citations": [], "fact_check": {"passed": True}, "engine": "azure"}

    async def build_recap(mid, persona, lang):
        return {"report_md": "report", "citations": [], "fact_check": {"passed": False}, "engine": "azure"}

    scores = iter([{"score": 5}, RuntimeError("judge down")] + [{"score": 4}] * 100)

    async def chat_json(system, user, max_tokens=0):
        s = next(scores)
        if isinstance(s, Exception):
            raise s
        return s

    monkeypatch.setattr(narrator, "narrate", narrate)
    monkeypatch.setattr(recap, "build_recap", build_recap)
    monkeypatch.setattr(clients, "chat_json", chat_json)
    out = asyncio.run(run.grounding_azure(sample=4))
    assert out["outputs"] > 4 and out["pass_rate"] < 1 and out["model_groundedness"]["evaluator"] == "LLM judge"
    assert 4 <= out["model_groundedness"]["mean"] <= 5


def _patch_heavy(monkeypatch, run, truth_recall=0.5):
    monkeypatch.setattr(run.store, "load", lambda: None)
    monkeypatch.setattr(run, "grounding_offline", lambda: {"outputs": 3, "pass_rate": 1.0, "bias_flags": 0, "failures": []})

    async def gaz():
        return {"outputs": 2, "pass_rate": 1.0, "engine": ["azure"], "model_groundedness": {"mean": 5}}

    monkeypatch.setattr(run, "grounding_azure", gaz)
    monkeypatch.setattr(run, "fidelity", lambda: {"fidelity": 1.0})
    monkeypatch.setattr(run, "tactical_detection", lambda: {"precision": 0.7, "recall": 0.3})
    monkeypatch.setattr(run, "calibration", lambda: {"pass_ratio": 1.0, "metrics_passed": 16, "metrics_total": 16, "brier": 0.47, "failing": []})
    monkeypatch.setattr(run, "scouting_accuracy", lambda: {"foot": {"accuracy": 1.0}, "penalty_side": {"accuracy": 0.8}})
    monkeypatch.setattr(run, "truth_suite", lambda: {"date": "2026-10-21", "recall": truth_recall, "false_alarms_per_match": 0.9,
                                                     "control_false_alarms_per_match": 0.9, "median_seconds_to_detect": 500,
                                                     "explanation_accuracy": 1.0, "by_difficulty": []})
    monkeypatch.setattr(run, "verifier_drill", lambda: {"drafts": 5, "caught": 5, "catch_rate": 1.0, "misses": []})


def test_eval_main_passes_records_and_writes(repo_tmp, monkeypatch, capsys):
    from app.evals import run
    _patch_heavy(monkeypatch, run)
    out = repo_tmp / "out" / "results.json"
    monkeypatch.setattr(sys, "argv", ["run", "--mode", "azure", "--output", str(out), "--record"])
    with pytest.raises(SystemExit) as e:
        run.main()
    assert e.value.code == 0
    res = json.loads(out.read_text())
    assert res["passed"] and res["gates"]["grounding_azure"] and res["gates"]["verifier_drill"]
    assert (repo_tmp / "data" / "reference" / "truth-latest.json").exists() and (repo_tmp / "docs" / "truth-score.svg").exists()
    assert '"verifier_drill"' in capsys.readouterr().out


def test_eval_main_fails_gate(repo_tmp, monkeypatch):
    from app.evals import run
    _patch_heavy(monkeypatch, run, truth_recall=0.1)
    monkeypatch.setattr(sys, "argv", ["run"])
    with pytest.raises(SystemExit) as e:
        run.main()
    assert e.value.code == 1


# ---------------------------------------------------------------- live engine


async def _collect(gen, limit=100000):
    out = []
    async for item in gen:
        out.append(item)
        if len(out) >= limit:
            break
    await gen.aclose()
    return out


def test_live_replay_stream_end_to_end(loaded_store):
    from app.live import replay
    an = loaded_store.analyzer(HERO)
    items = asyncio.run(_collect(replay.live_stream(HERO, speed=600, start_t=an.end_t - 420, persona="kids", language="en", drill=True)))
    kinds = [i["event"] for i in items]
    assert kinds[0] == "meta" and "end" in kinds and "event" in kinds and "snapshot" in kinds
    assert json.loads(items[0]["data"])["match_id"] == HERO
    narrated = [json.loads(i["data"]) for i in items if i["event"] == "moment" and "narrative" in i["data"]]
    assert narrated, "moments carry narratives"
    assert replay.latency_stats()["samples"] >= 1


def test_live_replay_from_kickoff_proposes_kickoff_cards(loaded_store):
    from app.live import replay
    items = asyncio.run(_collect(replay.live_stream(HERO, speed=600, start_t=0), limit=40))
    assert any(i["event"] == "studio" for i in items)


def test_live_eventhub_source(loaded_store, azure):
    from app.live import replay
    azure(live_source="eventhub")
    an = loaded_store.analyzer(HERO)
    evs = [dict(e, match_id=HERO) for e in an.events if e["t"] >= an.end_t - 240]
    evs[0]["seq"] = 1
    for e in evs:
        replay.hub.push(e)
    replay.hub.push({"no": "match id"})
    items = asyncio.run(_collect(replay.live_stream(HERO, speed=30)))
    kinds = [i["event"] for i in items]
    assert json.loads(items[0]["data"])["source"] == "eventhub" and kinds[-1] in ("end", "moment", "studio", "insight") and "end" in kinds


def test_hub_wait_times_out():
    from app.live import replay
    asyncio.run(replay.hub.wait("nobody", timeout=0.01))


def test_overlay_stream_ping_and_on_air(loaded_store, monkeypatch):
    from app.ai import producer
    from app.live import replay
    real_wait_for = asyncio.wait_for
    monkeypatch.setattr(replay.asyncio, "wait_for", lambda aw, timeout: real_wait_for(aw, 0.05))

    async def go():
        gen = replay.overlay_stream(HERO)
        first = await gen.__anext__()
        ping = await gen.__anext__()
        item = producer.propose(HERO)[0]
        producer.act(HERO, item["id"], "on_air")
        on_air = await gen.__anext__()
        await gen.aclose()
        return first, ping, on_air

    first, ping, on_air = asyncio.run(go())
    assert first["event"] == "ready" and ping["event"] == "ping" and on_air["event"] == "on_air"
    assert not producer._overlay_subscribers.get(HERO)


def test_sse_video_safe(monkeypatch):
    from app.live import replay
    monkeypatch.setattr(replay, "VIDEO_SAFE", True)
    assert "World tournament" in replay._sse("x", {"c": "FIFA World Cup"})["data"]
