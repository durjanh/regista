"""The producer's control room: the graphics queue, editorial actions, profiles, settings, audit and the overlay feed."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from ...ai import producer
from ...integrations import persistence
from ...live.replay import overlay_stream
from ..deps import require_match
from ..schemas import StudioAction, StudioNewItem, StudioSettings
from .matches import SSE_HEADERS

router = APIRouter(prefix="/api/studio", tags=["studio"])


@router.get("/profiles")
async def studio_profiles():
    return producer.PROFILES


@router.get("/{match_id}/queue")
async def studio_queue(upto_t: float | None = None, match_id: str = Depends(require_match)):
    return await asyncio.to_thread(producer.propose, match_id, upto_t)


@router.post("/{match_id}/items")
async def studio_add(req: StudioNewItem, match_id: str = Depends(require_match)):
    """Producer-authored graphic (e.g. from the half-time pack). Enters the queue as `proposed`, like agent proposals."""
    item = producer.add_item(match_id, req.model_dump())
    persistence.save("studio", item)
    return item


@router.post("/{match_id}/items/{item_id}")
async def studio_action(item_id: str, req: StudioAction, match_id: str = Depends(require_match)):
    try:
        item = producer.act(match_id, item_id, req.action, req.title, req.body)
        if req.action in ("approve", "edit") and len(item.get("cue", {}).get("languages", [])) > 1:
            await producer.translate_cue(item)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    except KeyError:
        raise HTTPException(404, f"Unknown studio item {item_id}") from None
    persistence.save("studio", item)
    return item


@router.get("/{match_id}/overlay")
async def studio_overlay(match_id: str = Depends(require_match)):
    return EventSourceResponse(overlay_stream(match_id), ping=15, headers=SSE_HEADERS)


@router.get("/{match_id}/settings")
async def studio_get_settings(match_id: str = Depends(require_match)):
    return producer.settings_for(match_id)


@router.post("/{match_id}/settings")
async def studio_set_settings(req: StudioSettings, match_id: str = Depends(require_match)):
    try:
        return producer.update_settings(match_id, req.profile_id, req.auto_approve_threshold, req.clear_threshold)
    except KeyError:
        raise HTTPException(404, f"Unknown profile {req.profile_id}") from None


@router.get("/{match_id}/audit")
async def studio_audit(match_id: str = Depends(require_match)):
    return producer.audit_log(match_id)
