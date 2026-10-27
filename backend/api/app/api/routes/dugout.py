"""The manager's view: one side's live dashboard and the assistant-coach agent's brief."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Query

from ...ai import coach
from ...analytics import dugout as dugout_view
from ...store import MatchStore
from ..deps import ensure_match, get_store, require_match
from ..schemas import BriefRequest

router = APIRouter(prefix="/api", tags=["dugout"])


@router.get("/matches/{match_id}/dugout")
async def match_dugout(side: str = Query("home", pattern="^(home|away)$"), upto_t: float | None = None,
                       match_id: str = Depends(require_match), store: MatchStore = Depends(get_store)):
    # Form baselines come from the scouting index; until it's built (cold start) the dugout answers without them and the
    # next poll picks them up, rather than waiting on the build.
    sc = store.scouting_if_ready()
    return await asyncio.to_thread(dugout_view.dugout, store.analyzer(match_id), store.get(match_id), side, upto_t, sc)


@router.post("/dugout/brief")
async def dugout_brief(req: BriefRequest, store: MatchStore = Depends(get_store)):
    ensure_match(store, req.match_id)
    return await coach.brief(req.match_id, req.side, req.upto_t, req.language)
