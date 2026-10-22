"""Data Forge tool: generate a what-if match. The only tool that changes state, so agents don't get it."""

from __future__ import annotations

from typing import Annotated

from ...forge.reference import slug
from ...store import store
from .registry import tool


@tool(read_only=False)
def generate_what_if(home_team: Annotated[str, "Home team name or id"], away_team: Annotated[str, "Away team name or id"],
                     scenario: Annotated[str, "balanced, late_drama, comeback, red_card, derby, tactical_chess, goal_fest or underdog"] = "balanced") -> dict:
    """Generate a synthetic what-if match between two real national teams (strength from Elo) and return its id."""
    from ...forge.matches import build_what_if
    doc = build_what_if(slug(home_team), slug(away_team), scenario=scenario)
    store.add_generated(doc)
    m = doc["meta"]
    return {"match_id": m["match_id"], "score": m["final_score"], "headline": m["headline_hint"], "elo": m["elo"]}
