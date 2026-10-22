"""Scouting and manager tools: a player's DNA, a team's scouting report, live dugout advice."""

from __future__ import annotations

from typing import Annotated

from ...forge.reference import slug
from ...store import store
from .lookup import minute_to_t
from .registry import tool


@tool()
def get_player_dna(player: Annotated[str, "Player name or player key, e.g. 'Harry Kane' or 'england:harry-kane'"]) -> dict:
    """Scouting report: REAL international record plus MODEL tendencies (shot sides, feet, penalty placement, keeper dives,
    physical output), strengths, weaknesses and how to stop him."""
    sc = store.ensure_scouting()
    key = player if ":" in player else next((k for k, a in sc.players.items() if a["name"].lower() == player.lower()), None)
    if not key:
        key = next((k for k, a in sc.players.items() if player.lower() in a["name"].lower()), None)
    if not key:
        return {"error": f"No scouting profile for '{player}'"}
    d = sc.player_dna(key)
    d["model"].pop("shot_map", None)
    d["model"].pop("goal_map", None)
    return d


@tool()
def get_team_report(team: Annotated[str, "Team name or id, e.g. 'Argentina'"]) -> dict:
    """Team scouting report: REAL home/away/neutral record, MODEL leaders (distance, passes, threat), penalty takers,
    keeper tendencies, danger men and how to play against them."""
    return store.ensure_scouting().team_report(slug(team))


@tool()
def get_dugout_advice(match_id: Annotated[str, "Match id"], side: Annotated[str, "'home' or 'away': the team you manage"],
                      minute: Annotated[int | None, "Match minute (omit for full time)"] = None) -> dict:
    """Live manager advice: player form vs baseline, fatigue, substitution recommendations with win-probability impact,
    tactical alerts and danger men."""
    from ...analytics.dugout import dugout
    d = dugout(store.analyzer(match_id), store.get(match_id), side, minute_to_t(match_id, minute), store.ensure_scouting())
    return {k: d[k] for k in ("minute", "score", "win_prob", "recommendations", "danger_men", "opponent_patterns")} | {
        "players": [{k: p[k] for k in ("name", "position", "rating", "baseline", "status", "reasons")} for p in d["players"] if p["on_pitch"]]}
