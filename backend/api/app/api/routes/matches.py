"""Matches and what happened in them: events, analysis, a moment's detail, player and physical stats, the live replay."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from ...analytics.stats import player_stats
from ...live.replay import live_stream
from ...services.matches import moment_detail, physical_report
from ...store import MatchStore
from ..deps import get_store, require_match

router = APIRouter(prefix="/api/matches", tags=["matches"])

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@router.get("")
async def matches(store: MatchStore = Depends(get_store)):
    return store.summaries()


@router.get("/{match_id}")
async def match(match_id: str = Depends(require_match), store: MatchStore = Depends(get_store)):
    meta = dict(store.get(match_id)["meta"])
    meta.pop("truth", None)   # what the generator planted stays hidden until truth mode
    return meta


@router.get("/{match_id}/events")
async def events(from_t: float = 0, to_t: float = 1e9, types: str | None = None,
                 match_id: str = Depends(require_match), store: MatchStore = Depends(get_store)):
    allowed = set(types.split(",")) if types else None
    return [e for e in store.get(match_id)["events"] if from_t <= e["t"] <= to_t and (allowed is None or e["type"] in allowed)]


@router.get("/{match_id}/analysis")
async def analysis(upto_t: float | None = None, match_id: str = Depends(require_match), store: MatchStore = Depends(get_store)):
    return await asyncio.to_thread(store.analyzer(match_id).analyze, upto_t)


@router.get("/{match_id}/moments/{moment_id}")
async def moment(moment_id: str, match_id: str = Depends(require_match), store: MatchStore = Depends(get_store)):
    try:
        return moment_detail(store.analyzer(match_id), moment_id)
    except KeyError:
        raise HTTPException(404, f"Unknown moment {moment_id}") from None


@router.get("/{match_id}/players")
async def players(upto_t: float | None = None, match_id: str = Depends(require_match), store: MatchStore = Depends(get_store)):
    an = store.analyzer(match_id)
    return player_stats(an.events_upto(upto_t), an.meta, upto_t)


@router.get("/{match_id}/physical")
async def match_physical(upto_t: float | None = None, match_id: str = Depends(require_match), store: MatchStore = Depends(get_store)):
    return physical_report(store.get(match_id), store.analyzer(match_id), upto_t)


@router.get("/{match_id}/live")
async def live(speed: float = 30, start_t: float = 0, persona: str = "casual", language: str = "en", drill: bool = False,
               match_id: str = Depends(require_match)):
    """drill=true runs the Verifier drill on insight lines: one overstated number is planted in each draft."""
    return EventSourceResponse(live_stream(match_id, speed, start_t, persona, language, drill), ping=15, headers=SSE_HEADERS)
