"""Video-safe mode (REGISTA_VIDEO_SAFE=1): replace trademarked competition names with generic labels in every JSON
response, so a recorded demo shows no third-party marks (hackathon rules, section 4.4). Team names are countries."""

from __future__ import annotations

import os
import re

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

ENABLED = os.environ.get("REGISTA_VIDEO_SAFE", "").lower() in ("1", "true", "yes")

# Longest names first so qualifiers are replaced before the tournament itself.
MARKS = [
    ("FIFA World Cup qualification", "World tournament qualifier"),
    ("UEFA Euro qualification", "European championship qualifier"),
    ("UEFA Nations League", "European nations competition"),
    ("CONCACAF Nations League", "North American nations competition"),
    ("African Cup of Nations qualification", "African championship qualifier"),
    ("FIFA World Cup", "World tournament"),
    ("UEFA Euro", "European championship"),
    ("Copa América", "South American championship"),
    ("African Cup of Nations", "African championship"),
    ("AFC Asian Cup", "Asian championship"),
    ("Gold Cup", "North American championship"),
    ("Confederations Cup", "Intercontinental cup"),
    ("World Cup", "World tournament"),
]
_PATTERN = re.compile("|".join(re.escape(m) for m, _ in MARKS))
_MAP = dict(MARKS)


def scrub(text: str) -> str:
    return _PATTERN.sub(lambda m: _MAP[m.group(0)], text)


class VideoSafeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if not ENABLED or "application/json" not in response.headers.get("content-type", ""):
            return response
        body = b"".join([chunk async for chunk in response.body_iterator])
        cleaned = scrub(body.decode("utf-8")).encode("utf-8")
        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
        return Response(content=cleaned, status_code=response.status_code, headers=headers, media_type="application/json")
