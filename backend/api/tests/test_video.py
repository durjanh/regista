"""Video reading: the model's answer is kept to the frames it was sent, and the route needs Azure OpenAI."""

from __future__ import annotations

import os

os.environ.setdefault("REGISTA_OFFLINE", "1")

import pytest
from fastapi.testclient import TestClient

from app.ai.video import clean
from app.api.deps import get_video_reader
from app.config import settings
from app.main import app

PIXEL = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="


@pytest.fixture(scope="module")
def client():
    """No lifespan here: the MCP session manager may only start once per process."""
    return TestClient(app)


def test_clean_keeps_the_model_to_the_frames_it_saw():
    raw = {
        "teams": {"a": {"kit": "white shirts", "name": "England"}, "b": {"kit": "sky-blue stripes", "name": None}},
        "frames": [{"t": 10.2, "view": "live", "possession": "a", "zone": "attacking_third", "scoreboard": "ENG 1-0 ARG 23:14"},
                   {"t": 11, "view": "replay", "possession": "b", "zone": "nowhere"},
                   {"t": 99, "view": "live", "possession": "a"}],                       # outside the batch: dropped
        "events": [{"t": 11.4, "type": "shot", "team": "a", "description": "Low shot saved"},
                   {"t": 10, "type": "teleport", "team": "a"},                           # not a football event: dropped
                   {"t": 40, "type": "goal", "team": "b"}],                              # outside the batch: dropped
        "summary": "England press high and force a save.",
    }
    out = clean(raw, [10.0, 11.0, 12.0])
    assert [f["t"] for f in out["frames"]] == [10.0, 11.0]
    assert out["frames"][1]["possession"] is None and out["frames"][1]["zone"] is None   # a replay isn't live possession
    assert out["events"] == [{"t": 11.0, "type": "shot", "team": "a", "description": "Low shot saved"}]
    assert out["teams"]["a"] == {"kit": "white shirts", "name": "England"}


def test_clean_keeps_earlier_team_labels():
    out = clean({"teams": {"a": {"kit": "red shirts"}}}, [0.0], {"a": {"kit": "white shirts", "name": "England"}})
    assert out["teams"]["a"] == {"kit": "white shirts", "name": "England"}
    assert out["teams"]["b"]["kit"] == "team B"


def test_read_needs_azure_openai(client):
    r = client.post("/api/video/read", json={"frames": [{"t": 0, "image": PIXEL}]})
    assert r.status_code == 501


def test_read_validates_and_returns_the_readers_answer(client, monkeypatch):
    seen = {}

    async def fake(frames, teams):
        seen["frames"], seen["teams"] = frames, teams
        return {"teams": teams or {}, "frames": [], "events": [], "summary": "ok", "model": "reasoning"}

    monkeypatch.setattr(type(settings), "llm", property(lambda self: True))
    app.dependency_overrides[get_video_reader] = lambda: fake
    try:
        r = client.post("/api/video/read", json={"frames": [{"t": 1.5, "image": PIXEL}], "teams": {"a": {"kit": "white shirts"}}})
        assert r.status_code == 200 and r.json()["summary"] == "ok"
        assert seen["frames"] == [{"t": 1.5, "image": PIXEL}] and seen["teams"]["a"]["kit"] == "white shirts"
        assert client.post("/api/video/read", json={"frames": [{"t": 0, "image": "https://example.com/x.jpg"}]}).status_code == 422
        assert client.post("/api/video/read", json={"frames": [{"t": 0, "image": PIXEL}] * 11}).status_code == 422
    finally:
        app.dependency_overrides.pop(get_video_reader, None)
