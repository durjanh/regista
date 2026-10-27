"""Video reading: any football clip, sampled into frames by the browser, read by the reasoning model (deps.get_video_reader)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from ...config import settings
from ..deps import ReadFrames, get_video_reader
from ..schemas import VideoReadRequest

log = logging.getLogger("regista.api.video")
router = APIRouter(prefix="/api/video", tags=["video"])


@router.post("/read")
async def read(req: VideoReadRequest, read_frames: ReadFrames = Depends(get_video_reader)):
    if not settings.llm:
        raise HTTPException(501, "Reading video needs Azure OpenAI (the reasoning deployment)")
    teams = {k: v.model_dump() for k, v in req.teams.items()} if req.teams else None
    try:
        return await read_frames([f.model_dump() for f in req.frames], teams)
    except Exception as exc:
        log.warning("Video reading failed: %s", exc)
        raise HTTPException(502, "The model couldn't read these frames; try again") from None
