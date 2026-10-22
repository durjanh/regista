"""The truth loop's read side: grade what the agents detected against what the generator planted, counterfactual
re-runs, and the CI truth score."""

from __future__ import annotations

import asyncio
import json

from ..analytics import counterfactual
from ..analytics.engine import minute_of
from ..analytics.grader import grade
from ..forge import reference as reference_module
from .memo import Memo

_counterfactuals: Memo[dict] = Memo()


async def truth_report(an, match_id: str, upto_t: float | None) -> dict:
    """Truth mode: reveal the planted changes and grade the insights detected up to the clock."""
    t = an.end_t if upto_t is None else min(upto_t, an.end_t)
    insights = await asyncio.to_thread(an.insights, t)
    insights = [i for i in insights if i["detected_t"] <= t]
    truth = an.meta.get("truth") or {}
    plants = truth.get("plants", [])
    g = grade(plants, insights, truth.get("labels", []), upto_minute=minute_of(t, an.meta), events=an.events)
    return {"match_id": match_id, "upto_t": t, "plants": plants, "insights": insights, "grades": g["grades"],
            "false_alarms": g["false_alarms"], "natural": g["natural"], "score": g["score"]}


async def counterfactual_run(doc: dict, match_id: str, plant_id: str, runs: int) -> dict:
    """Re-run the match without one planted change (cached per plant and run count). KeyError for an unknown plant."""
    return await _counterfactuals.get((match_id, plant_id, runs), lambda: asyncio.to_thread(counterfactual.run, doc, plant_id, runs))


def truth_score() -> dict:
    """Latest truth-suite result (CI artifact or local run) plus the per-commit history."""
    data = reference_module.REPO_ROOT / "data" / "reference"
    latest_path, hist_path = data / "truth-latest.json", data / "truth-score-history.json"
    latest = json.loads(latest_path.read_text()) if latest_path.exists() else None
    history = json.loads(hist_path.read_text()) if hist_path.exists() else []
    return {"latest": latest, "history": history}
