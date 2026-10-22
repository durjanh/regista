"""The real CC0 international results: summary, ranked teams, a team's DNA, head-to-head."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query

from ...forge.reference import ReferenceData
from ..deps import get_reference

router = APIRouter(prefix="/api/reference", tags=["reference"])


@router.get("/summary")
async def reference_summary(ref: ReferenceData = Depends(get_reference)):
    return ref.summary()


@router.get("/teams")
async def reference_teams(limit: int = Query(120, ge=1, le=400), ref: ReferenceData = Depends(get_reference)):
    return ref.ranking(limit=limit)


@router.get("/teams/{team_id}")
async def reference_team(team_id: str, ref: ReferenceData = Depends(get_reference)):
    try:
        return await asyncio.to_thread(ref.team_detail, team_id)
    except KeyError:
        raise HTTPException(404, f"Unknown team {team_id}") from None


@router.get("/h2h")
async def reference_h2h(a: str, b: str, before: str | None = None, ref: ReferenceData = Depends(get_reference)):
    try:
        return ref.h2h(ref.name_of(a), ref.name_of(b), before)
    except KeyError as exc:
        raise HTTPException(404, f"Unknown team {exc}") from None
