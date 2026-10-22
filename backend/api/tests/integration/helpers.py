"""Shared constants and the SSE parser for the integration and deployed suites."""

from __future__ import annotations

import json
from collections.abc import Iterator

import httpx

HERO = "2026-07-15-england-argentina"
ALLOWED_ORIGIN = "http://swa.example.test"


def sse_frames(response: httpx.Response) -> Iterator[tuple[str, object]]:
    """Parse a text/event-stream response into (event, data) pairs; comments and pings are skipped."""
    event, data = "message", []
    for line in response.iter_lines():
        if line.startswith(":"):
            continue
        if line == "":
            if data:
                raw = "\n".join(data)
                try:
                    payload: object = json.loads(raw)
                except json.JSONDecodeError:
                    payload = raw
                if event != "ping":
                    yield event, payload
            event, data = "message", []
            continue
        field, _, value = line.partition(":")
        value = value[1:] if value.startswith(" ") else value
        if field == "event":
            event = value
        elif field == "data":
            data.append(value)
