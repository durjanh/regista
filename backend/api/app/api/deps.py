"""Dependencies the routes receive through FastAPI's `Depends`, so each route names what it needs and a test swaps
any of them with `app.dependency_overrides[...]` instead of patching module globals."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Depends, HTTPException

from ..ai import services as azure_ai
from ..ai import video
from ..forge.reference import ReferenceData, reference
from ..store import MatchStore, store

Synthesize = Callable[[str, str, str | None], Awaitable[bytes]]
Translate = Callable[[list[str], str], Awaitable[list[str]]]
ReadFrames = Callable[[list[dict], dict | None], Awaitable[dict]]


def get_store() -> MatchStore:
    return store


def get_reference() -> ReferenceData:
    return reference()


def get_synthesizer() -> Synthesize:
    """Azure AI Speech."""
    return azure_ai.synthesize


def get_translator() -> Translate:
    """Azure AI Translator."""
    return azure_ai.translate


def get_video_reader() -> ReadFrames:
    """The reasoning model reading sampled video frames."""
    return video.read_frames


def ensure_match(matches: MatchStore, match_id: str) -> str:
    if match_id not in matches.docs:
        raise HTTPException(404, f"Unknown match {match_id}")
    return match_id


def require_match(match_id: str, matches: MatchStore = Depends(get_store)) -> str:
    """Path parameter `match_id`, 404 when the match isn't loaded."""
    return ensure_match(matches, match_id)
