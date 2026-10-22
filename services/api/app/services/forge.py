"""Data Forge use cases: the team list with neutral archetypes, generating a what-if match, the calibration report."""

from __future__ import annotations

import asyncio

from ..forge.calibration import run_calibration
from ..forge.matches import build_what_if
from ..forge.reference import ReferenceData
from ..integrations import persistence
from ..store import MatchStore
from .memo import Memo

_calibration: Memo[dict] = Memo()


async def calibration_report(n: int = 100) -> dict:
    """Synthetic vs real result distributions over `n` matches (computed once per n)."""
    return await _calibration.get(n, lambda: asyncio.to_thread(run_calibration, n))


async def forge_teams(ref: ReferenceData, limit: int) -> list[dict]:
    def build() -> list[dict]:
        out = []
        for t in ref.ranking(limit=limit):
            # profiled against an equal opponent, so the listed archetype is the team's neutral default
            profile = ref.team_profile(t["name"], ref.latest_date(), t["name"], home=True, neutral=True)
            out.append({**profile.payload(), "rank": t["rank"]})
        return out
    return await asyncio.to_thread(build)


async def generate_match(matches: MatchStore, cfg: dict) -> dict:
    """Build a what-if match, add it to the store and export it. MatchBuildError, KeyError or ValueError on bad input."""
    doc = await asyncio.to_thread(build_what_if, cfg["home_team_id"], cfg["away_team_id"], cfg["as_of"], cfg["scenario"],
                                  cfg["intensity"], cfg["seed"], True, cfg["home_formation"], cfg["away_formation"])
    matches.add_generated(doc)
    persistence.export_dataset(doc)
    persistence.save("matches", {"id": doc["meta"]["match_id"], "match_id": doc["meta"]["match_id"],
                                 **{k: v for k, v in doc["meta"].items() if k not in ("home", "away")}})
    summary = next(s for s in matches.summaries() if s["match_id"] == doc["meta"]["match_id"])
    return {"match": summary, "calibration": await calibration_report(n=100)}
