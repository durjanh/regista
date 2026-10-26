"""Regista evaluation suite: runs in CI (offline) and nightly against Azure (azure).

Measures what a broadcaster would ask about:
1. Grounding: share of generated narratives and recaps that pass the deterministic fact-checker (no unsupported
   numbers, no broken citations) and the fair-commentary guardrail.
2. Real-result fidelity: rebuilt real matches reproduce the real score, scorers and goal minutes.
3. Tactical detection vs ground truth: precision/recall of detected shape changes against the simulator's labels;
   the truth score (planted changes detected, false alarms, time to detect) and the Verifier drill (planted claim errors caught).
4. Calibration: synthetic engine vs real fixtures (goals, draws, home wins, penalties, timing) and event benchmarks;
   win-probability Brier score on real outcomes.
5. (azure mode) Model-judged groundedness of AI narratives: Azure AI Evaluation SDK when installed, else an LLM judge.

Usage: python -m app.evals.run --mode offline --threshold 0.95 [--output eval-results/results.json]
Exit code 1 when a gate fails.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import sys
import time
from pathlib import Path

from ..analytics import xt
from ..analytics.engine import MatchAnalyzer
from ..forge.calibration import run_calibration
from ..forge.matches import build_what_if
from ..forge.reference import FEATURED, reference
from ..store import store

PERSONAS = ["casual", "analyst", "kids", "fantasy", "broadcaster", "accessible"]


def grounding_offline() -> dict:
    from ..ai.factcheck import check
    from ..ai.facts import full_sheet, moment_sheet
    from ..ai.offline import moment_text, recap
    total = passed = bias = 0
    failures = []
    for mid in [m for m in store.order if store.docs[m]["meta"].get("featured")]:
        an = store.analyzer(mid)
        a = an.analyze()
        fs = full_sheet(an.meta, a)
        for p in PERSONAS:
            r = recap(an.meta, a, fs, p)
            c = check(" ".join([r["headline"], r["standfirst"], r["report_md"]]), fs)
            total += 1
            passed += c["passed"]
            bias += len(c["bias_flags"])
            if not c["passed"]:
                failures.append({"match": mid, "persona": p, "kind": "recap", "issues": c["issues"][:2]})
            for m in a["moments"]:
                ms = moment_sheet(an.meta, a, m)
                c = check(moment_text(m, an.meta, p, ms), ms)
                total += 1
                passed += c["passed"]
                bias += len(c["bias_flags"])
                if not c["passed"]:
                    failures.append({"match": mid, "persona": p, "kind": m["type"], "issues": c["issues"][:2]})
    return {"outputs": total, "pass_rate": round(passed / max(1, total), 4), "bias_flags": bias, "failures": failures[:10]}


async def grounding_azure(sample: int = 12) -> dict:
    from ..ai.narrator import narrate
    from ..ai.recap import build_recap
    results, judged = [], []
    rng = random.Random(7)
    featured = [m for m in store.order if store.docs[m]["meta"].get("featured")]
    for mid in featured[:4]:
        an = store.analyzer(mid)
        moments = [m for m in an.analyze()["moments"] if m["importance"] >= 50]
        for m in rng.sample(moments, min(len(moments), max(1, sample // 4))):
            n = await narrate(mid, "moment", rng.choice(PERSONAS), rng.choice(["en", "es", "fr"]), moment_id=m["id"])
            results.append(n)
        results.append(await build_recap(mid, "broadcaster", "en"))
    passed = sum(1 for r in results if r["fact_check"]["passed"])
    judged = await _judge(results)
    return {"outputs": len(results), "pass_rate": round(passed / max(1, len(results)), 4),
            "engine": sorted({r["engine"] for r in results}), "model_groundedness": judged}


async def _judge(results: list[dict]) -> dict:
    """Groundedness 1-5: Azure AI Evaluation SDK if available, otherwise an LLM judge on the same deployment."""
    texts = [(r.get("text") or r.get("report_md", ""), json.dumps(r.get("citations", []))) for r in results]
    try:
        from azure.ai.evaluation import GroundednessEvaluator

        from ..config import settings
        evaluator = GroundednessEvaluator(model_config={"azure_endpoint": settings.openai_endpoint,
                                                        "azure_deployment": settings.chat_deployment})
        scores = [evaluator(response=t, context=c).get("groundedness", 0) for t, c in texts]
        return {"evaluator": "azure-ai-evaluation GroundednessEvaluator", "mean": round(sum(scores) / max(1, len(scores)), 2)}
    except Exception:
        pass
    from ..ai.clients import chat_json
    scores = []
    for t, c in texts:
        try:
            out = await chat_json("You grade groundedness. Return JSON {\"score\": 1-5} where 5 means every claim in RESPONSE is supported by CONTEXT.",
                                  f"CONTEXT:\n{c}\n\nRESPONSE:\n{t}", max_tokens=200)
            scores.append(float(out.get("score", 0)))
        except Exception:
            continue
    return {"evaluator": "LLM judge", "mean": round(sum(scores) / max(1, len(scores)), 2) if scores else None}


def fidelity() -> dict:
    ref = reference()
    ok, rows = 0, []
    for d, h, _a in FEATURED:
        mid = next(m for m in store.order if m.startswith(d) and store.docs[m]["meta"].get("featured")
                   and store.docs[m]["meta"]["home"]["name"] == ref.current(h))
        doc = store.get(mid)
        real = doc["meta"]["source"]["real"]
        sim_goals = [e for e in doc["events"] if e.get("shot_outcome") == "goal"]
        score_ok = (doc["meta"]["final_score"]["home"], doc["meta"]["final_score"]["away"]) == (real["home_score"], real["away_score"])
        scorers_ok = len(sim_goals) == len(real["goals"]) and all(
            (g.get("own_goal_by") or g.get("player_name")) == r["scorer"] for g, r in zip(sim_goals, real["goals"]))
        minutes_ok = all(abs((g["minute"] + (g.get("added_minute") or 0)) - r["minute"]) <= 2
                         or (r["minute"] == 90 and g["minute"] == 90) for g, r in zip(sim_goals, real["goals"]))
        good = score_ok and scorers_ok and minutes_ok
        ok += good
        rows.append({"match": mid, "score": score_ok, "scorers": scorers_ok, "minutes": minutes_ok})
    return {"matches": len(rows), "fidelity": round(ok / max(1, len(rows)), 4), "rows": rows}


def tactical_detection(n_whatif: int = 24) -> dict:
    ref = reference()
    rk = [t["team_id"] for t in ref.ranking(limit=30)]
    rng = random.Random(5)
    docs = [store.get(m) for m in store.order if store.docs[m]["meta"].get("featured")]
    for i in range(n_whatif):
        h, a = rng.sample(rk, 2)
        d = build_what_if(h, a, seed=900 + i, max_tries=1, scenario=rng.choice(["balanced", "comeback", "red_card", "late_drama"]))
        xt.annotate(d["events"], store.xt_grid)
        docs.append(d)
    tp = fp = fn = 0
    for d in docs:
        a = MatchAnalyzer(d).analyze()
        truth = [lab for lab in d["meta"]["truth"]["labels"] if lab["type"] == "formation_change"]
        det = [(side, s) for side in ("home", "away") for s in a["tactics"][side]["shifts"]]
        matched = set()
        for lab in truth:
            hit = [k for k, (side, s) in enumerate(det) if d["meta"][side]["team_id"] == lab["team_id"]
                   and abs(s["minute"] - lab["minute"]) <= 3 and k not in matched]
            if hit:
                tp += 1
                matched.add(hit[0])
            else:
                fn += 1
        fp += len(det) - len(matched)
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    return {"matches": len(docs), "true_changes": tp + fn, "detected": tp + fp, "precision": round(precision, 3), "recall": round(recall, 3)}


def scouting_accuracy() -> dict:
    """Closed loop: does scouting rediscover the tendencies the engine was given (feet, penalty side, keeper dive)?"""
    from collections import Counter

    from ..forge.traits import traits_for
    sc = store.ensure_scouting()
    foot_ok = foot_n = pen_ok = pen_n = dive_ok = dive_n = 0
    for key, a in sc.players.items():
        pos = sc.position(a)
        tr = traits_for(key, pos)
        shots = [s for s in a["shots"] if s["body"] != "head"]
        if len(shots) >= 12 and tr.foot in ("left", "right"):
            c = Counter(s["body"] for s in shots)
            found = "left" if c["left_foot"] > c["right_foot"] else "right"
            foot_n += 1
            foot_ok += found == tr.foot
        if pos == "GK" and len(a["dives"]) >= 3:
            dna = sc.player_dna(key)["model"]["goalkeeping"]
            truth = max(("left", "right"), key=lambda k: tr.gk_dive[k])
            dive_n += 1
            dive_ok += max(("left", "right"), key=lambda k: dna["dive"][k]) == truth
        if len(a["pens"]) >= 1 or a["name_source"] == "dataset":
            dna = sc.player_dna(key)["model"]["penalties"] if a["pens"] or a["name_source"] == "dataset" else None
            if dna and dna["modelled_taken"] >= 10:
                truth = max(("left", "center", "right"), key=lambda k: tr.penalty[k])
                pen_n += 1
                pen_ok += max(("left", "center", "right"), key=lambda k: dna["placement"][k]) == truth
    return {"players": len(sc.players), "foot": {"checked": foot_n, "accuracy": round(foot_ok / max(1, foot_n), 3)},
            "penalty_side": {"checked": pen_n, "accuracy": round(pen_ok / max(1, pen_n), 3)},
            "keeper_dive": {"checked": dive_n, "accuracy": round(dive_ok / max(1, dive_n), 3)}}


MECHANISMS = ["press_switch", "tiring_fullback", "chaos_spell", "hot_streak", "set_piece_routine", "shape_change"]


def truth_suite(n: int = 48, seed: int = 5000) -> dict:
    """Plant hidden tactical changes in fresh matches (seeds never used for tuning), let the detectors find them,
    and grade: recall on observable plants, false alarms per match (with unplanted control matches), median seconds
    to detect, explanation accuracy, split by difficulty and mechanism."""
    import statistics
    from collections import Counter

    from ..analytics.grader import grade
    from ..analytics.insights import InsightEngine
    from ..forge import physical
    from ..forge.simulator import MatchSimulator
    ref = reference()
    d = ref.latest_date()
    teams = [t["name"] for t in ref.ranking(limit=30)]
    rng = random.Random(seed)
    hit, tot = Counter(), Counter()
    fa_all = fa_ctrl = n_ctrl = unobs = 0
    secs, expl = [], []
    for i in range(n):
        h, a = rng.sample(teams, 2)
        hp = ref.team_profile(h, d, a, True, True)
        ap = ref.team_profile(a, d, h, False, True)
        control = i % 4 == 3
        plants = []
        if not control:
            for j, mech in enumerate(rng.sample(MECHANISMS, 2)):
                side = rng.choice(["home", "away"])
                team = hp if side == "home" else ap
                p = {"id": f"p{j}", "mechanism": mech, "side": side, "minute": rng.randint(25, 70),
                     "difficulty": rng.choices(["obvious", "moderate", "subtle"], weights=[4, 4, 3])[0], "description": mech}
                if mech == "press_switch":
                    p["direction"] = "higher"
                elif mech == "shape_change":
                    p["direction"] = "back_five"
                elif mech == "chaos_spell":
                    p.update(side="both", duration=9)
                elif mech == "hot_streak":
                    p.update(player_id=next(x.player_id for x in team.squad if x.position == "ST" and x.starter), duration=15)
                elif mech == "tiring_fullback":
                    fb = next((x.player_id for x in team.squad if x.position in ("RB", "LB", "RWB", "LWB") and x.starter), None)
                    if not fb:
                        continue
                    p["player_id"] = fb
                plants.append(p)
        sim = MatchSimulator(hp, ap, seed=seed + i, neutral=True, plants=plants)
        sim.run()
        doc = sim.payload(f"truth-{i}", {})
        doc["physical"] = physical.compute(doc)
        insights = InsightEngine(doc).insights()
        g = grade(doc["meta"]["truth"]["plants"], insights, doc["meta"]["truth"]["labels"], events=doc["events"])
        for gr in g["grades"]:
            if not gr.get("observable", True) and not gr["detected"]:
                unobs += 1
                continue
            for key in (gr["mechanism"], "difficulty:" + gr["difficulty"], "all"):
                tot[key] += 1
                hit[key] += gr["detected"]
            if gr["detected"]:
                secs.append(gr["seconds_to_detect"])
                expl.append(bool(gr.get("explanation_correct")))
        fa_all += len(g["false_alarms"])
        if control:
            n_ctrl += 1
            fa_ctrl += len(g["false_alarms"])
    rate = lambda k: round(hit[k] / tot[k], 3) if tot[k] else None   # noqa: E731
    return {"date": __import__("datetime").date.today().isoformat(), "matches": n, "control_matches": n_ctrl,
            "plants": tot["all"], "unobservable": unobs, "recall": rate("all"),
            "false_alarms_per_match": round(fa_all / n, 2), "control_false_alarms_per_match": round(fa_ctrl / max(1, n_ctrl), 2),
            "median_seconds_to_detect": round(statistics.median(secs)) if secs else None,
            "explanation_accuracy": round(sum(expl) / len(expl), 3) if expl else None,
            "by_difficulty": [{"difficulty": d_, "recall": rate("difficulty:" + d_), "plants": tot["difficulty:" + d_]} for d_ in ("obvious", "moderate", "subtle")],
            "by_mechanism": [{"mechanism": m, "recall": rate(m), "plants": tot[m]} for m in MECHANISMS]}


def record_truth(result: dict) -> None:
    """Score every commit: append to docs/truth-score-history.json and redraw docs/truth-score.svg."""
    import json
    import os

    from ..forge.reference import REPO_ROOT
    hist_path = REPO_ROOT / "data" / "reference" / "truth-score-history.json"
    history = json.loads(hist_path.read_text()) if hist_path.exists() else []
    history.append({"date": result["date"], "commit": os.environ.get("GITHUB_SHA", "local")[:7], "recall": result["recall"],
                    "false_alarms_per_match": result["false_alarms_per_match"], "median_seconds_to_detect": result["median_seconds_to_detect"]})
    history = history[-60:]
    hist_path.write_text(json.dumps(history, indent=1))
    w, h, pad = 640, 220, 40
    pts = [(r.get("recall") or 0) for r in history]
    fas = [min(3.0, r.get("false_alarms_per_match") or 0) / 3 for r in history]
    n = max(1, len(pts) - 1)
    xy = lambda i, v: (pad + i * (w - 2 * pad) / n, h - pad - v * (h - 2 * pad))   # noqa: E731
    line = lambda vals: " ".join(f"{x:.1f},{y:.1f}" for x, y in (xy(i, v) for i, v in enumerate(vals)))   # noqa: E731
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="system-ui,sans-serif" font-size="12">'
           f'<rect width="{w}" height="{h}" fill="#0B1220"/><text x="{pad}" y="22" fill="#E5E7EB" font-weight="700">Truth score per commit</text>'
           f'<text x="{w - pad}" y="22" fill="#22C55E" text-anchor="end">recall</text><text x="{w - pad - 60}" y="22" fill="#F59E0B" text-anchor="end">false alarms/match (÷3)</text>'
           f'<line x1="{pad}" y1="{h - pad}" x2="{w - pad}" y2="{h - pad}" stroke="#334155"/>'
           f'<polyline fill="none" stroke="#22C55E" stroke-width="2.5" points="{line(pts)}"/>'
           f'<polyline fill="none" stroke="#F59E0B" stroke-width="2" stroke-dasharray="5 4" points="{line(fas)}"/>'
           f'<text x="{pad}" y="{h - 12}" fill="#94A3B8">latest: recall {result["recall"]}, {result["false_alarms_per_match"]} false alarms/match, '
           f'median {result["median_seconds_to_detect"]} s to detect</text></svg>')
    (REPO_ROOT / "docs" / "truth-score.svg").write_text(svg)


def verifier_drill() -> dict:
    """Plant one overstated number in every offline line (moments x personas, detected changes) and check that the
    Verifier catches it. A regression gate on the fact-checker: loosen what counts as evidence and planted errors
    start to slip through. Known limitation, not measured here: a real number attached to the wrong claim passes."""
    from ..ai.factcheck import check, plant_error
    from ..ai.facts import moment_sheet
    from ..ai.narrator import insight_sheet
    from ..ai.offline import moment_text
    drafts = caught = 0
    misses = []
    for mid in [m for m in store.order if store.docs[m]["meta"].get("featured")]:
        an = store.analyzer(mid)
        a = an.analyze()
        lines = [(moment_text(m, an.meta, p, ms), ms) for m in a["moments"] for ms in [moment_sheet(an.meta, a, m)] for p in PERSONAS]
        lines += [(ins["text"], insight_sheet(an, ins)) for ins in an.insights()]
        for i, (text, fs) in enumerate(lines):
            planted = plant_error(text, fs, random.Random(i))
            if not planted:
                continue
            drafts += 1
            if any(x["problem"] == planted["problem"] for x in check(planted["text"], fs)["issues"]):
                caught += 1
            else:
                misses.append({"match": mid, "planted": planted["planted"], "draft": planted["text"][:160]})
    return {"drafts": drafts, "caught": caught, "catch_rate": round(caught / max(1, drafts), 4), "misses": misses[:5]}


def calibration(n: int = 100) -> dict:
    c = run_calibration(n=n)
    passed = sum(1 for m in c["metrics"] if m["status"] == "pass")
    brier = next(m["simulated"] for m in c["metrics"] if m["metric"].startswith("Win-probability Brier"))
    return {"fixtures": c["n_matches"], "metrics_passed": passed, "metrics_total": len(c["metrics"]),
            "pass_ratio": round(passed / len(c["metrics"]), 3), "brier": brier,
            "failing": [m["metric"] for m in c["metrics"] if m["status"] != "pass"]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Regista evaluation suite")
    parser.add_argument("--mode", choices=["offline", "azure"], default="offline")
    parser.add_argument("--threshold", type=float, default=0.95, help="Minimum grounding pass rate")
    parser.add_argument("--output", default=None, help="Write results JSON here")
    parser.add_argument("--record", action="store_true", help="Append the truth score to docs/truth-score-history.json")
    args = parser.parse_args()
    t0 = time.time()
    store.load()
    results = {"mode": args.mode, "grounding": grounding_offline()}
    if args.mode == "azure":
        results["grounding_azure"] = asyncio.run(grounding_azure())
    results["real_result_fidelity"] = fidelity()
    results["tactical_detection"] = tactical_detection()
    results["calibration"] = calibration()
    results["scouting"] = scouting_accuracy()
    results["truth"] = truth_suite()
    results["verifier_drill"] = verifier_drill()
    gates = {
        "grounding": results["grounding"]["pass_rate"] >= args.threshold,
        "fair_commentary": results["grounding"]["bias_flags"] == 0,
        "real_result_fidelity": results["real_result_fidelity"]["fidelity"] == 1.0,
        "tactical_precision": results["tactical_detection"]["precision"] >= 0.6,
        "calibration": results["calibration"]["pass_ratio"] >= 0.8,
        "scouting_recovery": results["scouting"]["foot"]["accuracy"] >= 0.85 and results["scouting"]["penalty_side"]["accuracy"] >= 0.6,
        "truth_score": (results["truth"]["recall"] or 0) >= 0.35 and results["truth"]["false_alarms_per_match"] <= 1.5,
        "verifier_drill": results["verifier_drill"]["catch_rate"] == 1.0,
    }
    if args.mode == "azure":
        gates["grounding_azure"] = results["grounding_azure"]["pass_rate"] >= args.threshold - 0.1
    results["gates"] = gates
    results["passed"] = all(gates.values())
    results["seconds"] = round(time.time() - t0, 1)
    text = json.dumps(results, indent=2, default=str)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(text)
    summary = {k: v for k, v in results.items() if k in ("gates", "passed", "seconds")}
    summary["grounding_pass_rate"] = results["grounding"]["pass_rate"]
    summary["fidelity"] = results["real_result_fidelity"]["fidelity"]
    summary["tactical"] = results["tactical_detection"]
    summary["calibration"] = {k: results["calibration"][k] for k in ("metrics_passed", "metrics_total", "brier", "failing")}
    summary["scouting"] = results["scouting"]
    summary["verifier_drill"] = {k: results["verifier_drill"][k] for k in ("drafts", "catch_rate")}
    summary["truth"] = {k: results["truth"][k] for k in ("recall", "false_alarms_per_match", "control_false_alarms_per_match",
                                                          "median_seconds_to_detect", "explanation_accuracy", "by_difficulty")}
    from ..forge.reference import REPO_ROOT
    (REPO_ROOT / "data" / "reference" / "truth-latest.json").write_text(json.dumps(results["truth"], indent=2))
    if args.record:
        record_truth(results["truth"])
    print(json.dumps(summary, indent=2))
    sys.exit(0 if results["passed"] else 1)


if __name__ == "__main__":
    main()
