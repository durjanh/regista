"""Data Forge: synthetic matches directed in plain English, calibrated against 49,000 real results."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ...ai.director import direct
from ...forge.matches import MatchBuildError
from ...forge.reference import ReferenceData
from ...services.forge import calibration_report, generate_match, rebuild_real_match
from ...services.forge import forge_teams as list_forge_teams
from ...store import MatchStore
from ..deps import get_reference, get_store
from ..schemas import ForgeConfig, ReplayRequest, ScenarioRequest

router = APIRouter(prefix="/api/forge", tags=["forge"])


@router.get("/teams")
async def forge_teams(limit: int = Query(48, ge=2, le=120), ref: ReferenceData = Depends(get_reference)):
    return await list_forge_teams(ref, limit)


@router.post("/scenario")
async def forge_scenario(req: ScenarioRequest):
    return await direct(req.prompt)


@router.post("/generate")
async def forge_generate(cfg: ForgeConfig, ref: ReferenceData = Depends(get_reference), store: MatchStore = Depends(get_store)):
    if cfg.home_team_id not in ref.names or cfg.away_team_id not in ref.names:
        raise HTTPException(400, "Unknown team id") from None
    try:
        return await generate_match(store, cfg.model_dump())
    except (MatchBuildError, KeyError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from None


@router.get("/real")
async def forge_real_results(team: str, opponent: str | None = None, year: int | None = Query(None, ge=1872, le=2100),
                             limit: int = Query(40, ge=1, le=100), ref: ReferenceData = Depends(get_reference)):
    """A team's real results, newest first, each marked replayable or with the reason it isn't."""
    try:
        return ref.search_results(team, opponent, year, limit)
    except KeyError as exc:
        raise HTTPException(404, f"Unknown team {exc}") from None


@router.post("/real")
async def forge_replay_real(req: ReplayRequest, ref: ReferenceData = Depends(get_reference), store: MatchStore = Depends(get_store)):
    """Rebuild a real result for replay and return its match summary (at once when it is already built)."""
    try:
        return await rebuild_real_match(store, ref, req.match_id)
    except KeyError:
        raise HTTPException(404, f"No real result {req.match_id}") from None
    except MatchBuildError as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/calibration")
async def forge_calibration(n: int = Query(100, ge=6, le=200)):
    return await calibration_report(n)
