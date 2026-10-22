"""The agents' words: moment / half-time / full-time narration, the recap, and answers to fans' questions."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ...ai.ask import ask as ask_agent
from ...ai.narrator import narrate
from ...ai.recap import build_recap
from ...integrations import persistence
from ...store import MatchStore
from ..deps import ensure_match, get_store
from ..schemas import AskRequest, NarrateRequest, RecapRequest

router = APIRouter(prefix="/api", tags=["narration"])


@router.post("/narrate")
async def narrate_endpoint(req: NarrateRequest, store: MatchStore = Depends(get_store)):
    ensure_match(store, req.match_id)
    try:
        result = await narrate(req.match_id, req.scope, req.persona, req.language, req.moment_id, req.upto_t)
    except KeyError as exc:
        raise HTTPException(404, f"Unknown moment {exc}") from None
    persistence.save("narratives", result)
    return result


@router.post("/recap")
async def recap_endpoint(req: RecapRequest, store: MatchStore = Depends(get_store)):
    ensure_match(store, req.match_id)
    result = await build_recap(req.match_id, req.persona, req.language)
    persistence.save("recaps", {"id": f"{req.match_id}-{req.persona}-{req.language}", **result})
    return result


@router.post("/ask")
async def ask_endpoint(req: AskRequest, store: MatchStore = Depends(get_store)):
    ensure_match(store, req.match_id)
    return await ask_agent(req.match_id, req.question, req.persona, req.language, req.upto_t, req.history)
