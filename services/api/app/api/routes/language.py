"""Azure AI Speech and Translator. Both engines are injected (deps.get_synthesizer / get_translator)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response

from ...config import settings
from ...services.speech import speak
from ..deps import Synthesize, Translate, get_synthesizer, get_translator
from ..schemas import SpeechRequest, TranslateRequest

log = logging.getLogger("regista.api.language")
router = APIRouter(prefix="/api", tags=["language"])


@router.post("/speech")
async def speech(req: SpeechRequest, synthesize: Synthesize = Depends(get_synthesizer)):
    if not settings.speech:
        raise HTTPException(501, "Speech is not configured; use the browser speech synthesis fallback")
    try:
        audio = await speak(synthesize, req.text, req.language, req.persona)
    except Exception as exc:
        log.warning("Speech synthesis failed: %s", exc)
        raise HTTPException(502, "Speech synthesis failed") from None
    return Response(audio, media_type="audio/mpeg")


@router.post("/translate")
async def translate_endpoint(req: TranslateRequest, translate: Translate = Depends(get_translator)):
    if not settings.translator or req.to == "en":
        return {"texts": req.texts, "engine": "offline"}
    try:
        return {"texts": await translate(req.texts, req.to), "engine": "azure"}
    except Exception as exc:
        log.warning("Translation failed: %s", exc)
        return {"texts": req.texts, "engine": "offline"}
