"""Data Forge: synthetic matches directed in plain English, calibrated against 49,000 real results."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ...ai.director import direct
from ...forge.matches import MatchBuildError
from ...forge.reference import ReferenceData
from ...services.forge import calibration_report, generate_match
from ...services.forge import forge_teams as list_forge_teams
from ...store import MatchStore
from ..deps import get_reference, get_store
from ..schemas import ForgeConfig, ScenarioRequest

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


@router.get("/calibration")
async def forge_calibration(n: int = Query(100, ge=6, le=200)):
    return await calibration_report(n)
