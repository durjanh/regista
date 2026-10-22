"""The shared live broadcast on Azure Web PubSub: client access for viewers, start / stop / status for producers."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ...live import broadcast
from ...store import MatchStore
from ..deps import ensure_match, get_store, require_match
from ..schemas import BroadcastStart

router = APIRouter(prefix="/api", tags=["realtime"])


@router.get("/realtime/negotiate")
async def realtime_negotiate(match_id: str, language: str = "en", monitor: bool = False, store: MatchStore = Depends(get_store)):
    """A short-lived Web PubSub client URL for one match (Entra-issued; join-only roles). enabled=false -> use SSE.
    monitor=true for the Studio: its connection isn't counted as a viewer."""
    ensure_match(store, match_id)
    return await broadcast.negotiate(match_id, language, monitor)


@router.post("/broadcast/{match_id}/start")
async def broadcast_start(req: BroadcastStart, match_id: str = Depends(require_match)):
    """Start the shared live timeline for everyone watching this match (idempotent while live)."""
    return broadcast.start(match_id, req.speed, req.start_t, req.languages)


@router.post("/broadcast/{match_id}/stop")
async def broadcast_stop(match_id: str = Depends(require_match)):
    return broadcast.stop(match_id)


@router.get("/broadcast/status")
async def broadcast_status():
    return broadcast.status()
