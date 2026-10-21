"""Calibration of the synthetic engine against real football.

Two checks, both shown in the Data Forge UI:
1. Backtest: sample real competitive fixtures (since 2018), simulate each as a what-if with the teams' Elo as of that
   date, and compare the simulated distributions with what really happened in those same fixtures, plus goal
   timing and penalty share against every recorded goal since 1990.
2. Event realism: per-match event volumes versus typical top-flight ranges (the results dataset has no event data,
   so these ranges are labelled as benchmarks, not measurements).
The win-probability prior is scored with a multi-class Brier score on the same real fixtures.
"""

from __future__ import annotations

import math
import random
import statistics
from collections import Counter

from ..analytics.winprob import outcome_probs
from .matches import build_what_if
from .reference import DATASET, ReferenceData, reference, slug

EVENT_BENCHMARKS = [
    # metric, low, high, unit
    ("Shots per match", 20, 30, None),
    ("Shots on target per match", 6.5, 11, None),
    ("Passes per match", 800, 1150, None),
    ("Pass completion", 0.77, 0.87, "ratio"),
    ("Corners per match", 8, 12.5, None),
    ("Fouls per match", 17, 26, None),
    ("Yellow cards per match", 2.5, 5, None),
    ("Offsides per match", 2.5, 6, None),
    ("xG per shot", 0.09, 0.13, None),
    ("xG per match", 2.3, 3.4, None),
]
BENCHMARK_SOURCE = "Typical top-flight club football range (benchmark)"


def _status(value: float, low: float, high: float) -> str:
    if low <= value <= high:
        return "pass"
    span = high - low
    return "warn" if (low - 0.25 * span) <= value <= (high + 0.25 * span) else "fail"


def run_calibration(n: int = 24, seed: int = 11, ref: ReferenceData | None = None) -> dict:
    ref = ref or reference()
    rng = random.Random(seed)
    pool = [r for r in ref.results if r["date"] >= "2018-01-01" and r["tournament"] != "Friendly"
            and len(ref.elo_hist.get(r["home_team"], [])) > 30 and len(ref.elo_hist.get(r["away_team"], [])) > 30]
    fixtures = rng.sample(pool, min(n, len(pool)))

    sims, reals, brier = [], [], []
    for i, r in enumerate(fixtures):
        doc = build_what_if(slug(r["home_team"]), slug(r["away_team"]), as_of=r["date"], neutral=r["neutral"],
                            seed=seed * 1000 + i, max_tries=1, ref=ref)
        sims.append(doc)
        reals.append(r)
        eh, ea = ref.pre_elo[(r["date"], r["home_team"], r["away_team"])]
        lh, la = ref.expected_goals(eh, ea, r["neutral"])
        p = outcome_probs(lh, la)
        outcome = "home" if r["home_score"] > r["away_score"] else "draw" if r["home_score"] == r["away_score"] else "away"
        brier.append(sum((p[k] - (1.0 if k == outcome else 0.0)) ** 2 for k in ("home", "draw", "away")))

    def per_match(fn) -> float:
        return statistics.mean(fn(d) for d in sims)

    def count(d: dict, pred) -> int:
        return sum(1 for e in d["events"] if pred(e))

    shots = sum(count(d, lambda e: e["type"] == "shot") for d in sims)
    xg = sum(sum(e.get("xg", 0) for e in d["events"] if e["type"] == "shot") for d in sims)
    passes = [e for d in sims for e in d["events"] if e["type"] == "pass"]
    event_values = {
        "Shots per match": per_match(lambda d: count(d, lambda e: e["type"] == "shot")),
        "Shots on target per match": per_match(lambda d: count(d, lambda e: e.get("shot_outcome") in ("goal", "saved"))),
        "Passes per match": len(passes) / len(sims),
        "Pass completion": sum(1 for e in passes if e["outcome"] == "success") / max(1, len(passes)),
        "Corners per match": per_match(lambda d: count(d, lambda e: e["type"] == "corner")),
        "Fouls per match": per_match(lambda d: count(d, lambda e: e["type"] == "foul")),
        "Yellow cards per match": per_match(lambda d: count(d, lambda e: e.get("card") == "yellow")),
        "Offsides per match": per_match(lambda d: count(d, lambda e: e["type"] == "offside")),
        "xG per shot": xg / max(1, shots),
        "xG per match": xg / len(sims),
    }

    real_ref = ref.calibration_reference()
    sim_goals = [sum(d["meta"]["final_score"].values()) for d in sims]
    real_goals = [r["home_score"] + r["away_score"] for r in reals]
    nn_idx = [i for i, r in enumerate(reals) if not r["neutral"]]
    sim_draw = sum(1 for d in sims if d["meta"]["final_score"]["home"] == d["meta"]["final_score"]["away"]) / len(sims)
    real_draw = sum(1 for r in reals if r["home_score"] == r["away_score"]) / len(reals)
    sim_home = (sum(1 for i in nn_idx if sims[i]["meta"]["final_score"]["home"] > sims[i]["meta"]["final_score"]["away"]) / len(nn_idx)) if nn_idx else 0
    real_home = (sum(1 for i in nn_idx if reals[i]["home_score"] > reals[i]["away_score"]) / len(nn_idx)) if nn_idx else 0
    goals_ev = [e for d in sims for e in d["events"] if e.get("shot_outcome") == "goal"]
    sim_pen = sum(1 for e in goals_ev if e.get("situation") == "penalty") / max(1, len(goals_ev))

    def goal_minute(e: dict) -> int:
        return e["minute"] + (e.get("added_minute") or 0)
    sim_late = sum(1 for e in goals_ev if goal_minute(e) > 75) / max(1, len(goals_ev))
    sim_bins = Counter(min((goal_minute(e) - 1) // 15, 5) for e in goals_ev)
    tot = max(1, sum(sim_bins.values()))
    labels = ["1-15", "16-30", "31-45", "46-60", "61-75", "76-90+"]

    metrics = []
    real_source = f"Real outcomes of the same {len(reals)} fixtures ({DATASET['licence']} dataset)"
    n_fix = len(reals)
    # 95% bands for the difference between two samples of this size (so small samples are not judged too harshly)
    goal_ref = statistics.mean(real_goals)
    goal_sd = statistics.pstdev(real_goals + sim_goals) or 1.6
    g_tol = max(0.35, 1.96 * goal_sd * math.sqrt(2 / n_fix))
    metrics.append({"metric": "Goals per match", "simulated": round(statistics.mean(sim_goals), 3), "reference": round(goal_ref, 3),
                    "low": round(goal_ref - g_tol, 2), "high": round(goal_ref + g_tol, 2),
                    "status": _status(statistics.mean(sim_goals), goal_ref - g_tol, goal_ref + g_tol), "source": real_source})

    def p_tol(p: float, n: int) -> float:
        return max(0.06, 1.96 * math.sqrt(2 * max(p * (1 - p), 0.05) / max(n, 1)))
    d_tol = p_tol(real_draw, n_fix)
    metrics.append({"metric": "Draw rate", "simulated": round(sim_draw, 3), "reference": round(real_draw, 3), "unit": "ratio",
                    "low": round(max(0, real_draw - d_tol), 2), "high": round(real_draw + d_tol, 2),
                    "status": _status(sim_draw, real_draw - d_tol, real_draw + d_tol), "source": real_source})
    if nn_idx:
        h_tol = p_tol(real_home, len(nn_idx))
        metrics.append({"metric": "Home win rate (non-neutral)", "simulated": round(sim_home, 3), "reference": round(real_home, 3), "unit": "ratio",
                        "low": round(max(0, real_home - h_tol), 2), "high": round(min(1, real_home + h_tol), 2),
                        "status": _status(sim_home, real_home - h_tol, real_home + h_tol), "source": real_source})
    gl_src = f"All recorded goals since 1990 ({DATASET['licence']} dataset)"
    n_goals = max(1, len(goals_ev))
    pen_ref, late_ref = real_ref["penalty_share"], real_ref["late_goal_share"]
    pen_tol = max(0.04, 1.96 * math.sqrt(pen_ref * (1 - pen_ref) / n_goals))
    late_tol = max(0.06, 1.96 * math.sqrt(late_ref * (1 - late_ref) / n_goals))
    metrics.append({"metric": "Penalty share of goals", "simulated": round(sim_pen, 3), "reference": round(pen_ref, 3), "unit": "ratio",
                    "low": round(max(0, pen_ref - pen_tol), 3), "high": round(pen_ref + pen_tol, 3),
                    "status": _status(sim_pen, pen_ref - pen_tol, pen_ref + pen_tol), "source": gl_src})
    metrics.append({"metric": "Share of goals after 75'", "simulated": round(sim_late, 3), "reference": round(late_ref, 3), "unit": "ratio",
                    "low": round(late_ref - late_tol, 3), "high": round(late_ref + late_tol, 3),
                    "status": _status(sim_late, late_ref - late_tol, late_ref + late_tol), "source": gl_src})
    b = statistics.mean(brier)
    metrics.append({"metric": "Win-probability Brier score (lower is better)", "simulated": round(b, 3), "reference": 0.667,
                    "low": 0.0, "high": 0.62, "status": "pass" if b < 0.62 else "warn",
                    "source": f"Elo goal model on the same {len(reals)} real fixtures vs a uniform 1/3 guess (0.667)"})
    for name, low, high, unit in EVENT_BENCHMARKS:
        v = event_values[name]
        m = {"metric": name, "simulated": round(v, 3), "reference": round((low + high) / 2, 3), "low": low, "high": high,
             "status": _status(v, low, high), "source": BENCHMARK_SOURCE}
        if unit:
            m["unit"] = unit
        metrics.append(m)

    sim_scores = Counter(f"{min(d['meta']['final_score']['home'], 5)}-{min(d['meta']['final_score']['away'], 5)}" for d in sims)
    return {
        "n_matches": len(sims),
        "reference": {"name": DATASET["name"], "source": DATASET["source"], "licence": DATASET["licence"], "matches": real_ref["matches"]},
        "goal_model": {"fitted_on": ref.goal_model["fitted_on"], "home": ref.goal_model["home"], "away": ref.goal_model["away"]},
        "metrics": metrics,
        "goal_minute_distribution": [{"bin": labels[i], "simulated": round(sim_bins[i] / tot, 3),
                                      "reference": round(real_ref["goal_minute_bins"][i], 3)} for i in range(6)],
        "scoreline_distribution": [{"score": k, "simulated": round(sim_scores.get(k, 0) / len(sims), 3), "reference": round(v, 3)}
                                   for k, v in list(real_ref["scorelines"].items())[:8]],
        "fixtures": [{"date": r["date"], "home": r["home_team"], "away": r["away_team"], "real": f"{r['home_score']}-{r['away_score']}",
                      "simulated": f"{d['meta']['final_score']['home']}-{d['meta']['final_score']['away']}"} for r, d in zip(reals, sims)],
    }
