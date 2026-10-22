"""Spoken lines: each (text, language, persona) is synthesised once, kept in memory and archived to Blob storage."""

from __future__ import annotations

import hashlib

from ..integrations import persistence
from .memo import Memo

_audio: Memo[bytes] = Memo()


def audio_key(text: str, language: str, persona: str | None) -> str:
    return hashlib.sha1(f"{language}|{persona}|{text}".encode()).hexdigest()[:20]


async def speak(synthesize, text: str, language: str, persona: str | None) -> bytes:
    """MP3 for the line; `synthesize` is the injected speech engine (Azure AI Speech in production). A failure
    propagates and is not cached."""
    key = audio_key(text, language, persona)

    async def fresh() -> bytes:
        audio = await synthesize(text, language, persona)
        persistence.save_blob("audio", f"{key}.mp3", audio, "audio/mpeg")
        return audio
    return await _audio.get(key, fresh)
