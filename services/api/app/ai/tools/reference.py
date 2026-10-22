"""Real-results tools: head-to-head and team history from the CC0 international results (1872-2026)."""

from __future__ import annotations

from typing import Annotated

from ...forge.reference import reference, slug
from .registry import tool


@tool()
def get_head_to_head(team_a: Annotated[str, "Team name or id"], team_b: Annotated[str, "Team name or id"],
                     before_date: Annotated[str | None, "Only matches before this date (YYYY-MM-DD)"] = None) -> dict:
    """Real head-to-head record between two national teams from 49,945 results (1872-2026)."""
    ref = reference()
    a = ref.names.get(slug(team_a), team_a)
    b = ref.names.get(slug(team_b), team_b)
    return {"team_a": a, "team_b": b, **ref.h2h(a, b, before_date), "source": "International results 1872-2026 (CC0)"}


@tool()
def get_team_history(team: Annotated[str, "Team name or id"]) -> dict:
    """Real all-time record, current Elo and rank, recent results and top scorers for a national team."""
    d = reference().team_detail(slug(team))
    d["elo_history"] = d["elo_history"][-12:]
    return d
