"""Scouting: the player search, a player's DNA and a team's scouting report (real data plus labelled model output)."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from ...store import MatchStore
from ..deps import get_store

router = APIRouter(prefix="/api/scouting", tags=["scouting"])


@router.get("/players")
async def scouting_players(team_id: str | None = None, q: str | None = None, store: MatchStore = Depends(get_store)):
    sc = await asyncio.to_thread(store.ensure_scouting)
    return sc.search(team_id, q)


@router.get("/players/{player_key}")
async def scouting_player(player_key: str, store: MatchStore = Depends(get_store)):
    sc = await asyncio.to_thread(store.ensure_scouting)
    try:
        return await asyncio.to_thread(sc.player_dna, player_key)
    except KeyError:
        raise HTTPException(404, f"No scouting profile for {player_key}") from None


@router.get("/teams/{team_id}")
async def scouting_team(team_id: str, store: MatchStore = Depends(get_store)):
    sc = await asyncio.to_thread(store.ensure_scouting)
    try:
        return await asyncio.to_thread(sc.team_report, team_id)
    except KeyError:
        raise HTTPException(404, f"Unknown team {team_id}") from None
