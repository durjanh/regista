"""The layering itself: routes depend on injected collaborators, and the application services' memo semantics."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(loaded_store):
    from app.main import app
    return TestClient(app)


def test_routes_take_the_store_from_a_dependency(client, monkeypatch):
    """Dependency inversion: swap the store for a fake and the routes serve it, with no patching of module globals."""
    from app.api.deps import get_store

    class FakeStore:
        docs = {"m-fake": {"meta": {"match_id": "m-fake", "truth": {"plants": ["hidden"]}}, "events": [{"t": 5, "type": "shot"}]}}

        def summaries(self):
            return [{"match_id": "m-fake"}]

        def get(self, match_id):
            return self.docs[match_id]

    monkeypatch.setitem(client.app.dependency_overrides, get_store, FakeStore)
    assert client.get("/api/matches").json() == [{"match_id": "m-fake"}]
    assert client.get("/api/matches/m-fake").json() == {"match_id": "m-fake"}          # the truth stays hidden
    assert client.get("/api/matches/m-fake/events", params={"types": "shot"}).json() == [{"t": 5, "type": "shot"}]
    assert client.get("/api/matches/2026-07-15-england-argentina").status_code == 404   # not in the fake store


def test_every_domain_has_its_own_router():
    from app.api.routes import ROUTERS
    from app.main import app
    prefixes = {r.prefix for r in ROUTERS}
    assert {"/api/matches", "/api/studio", "/api/forge", "/api/scouting", "/api/reference", "/api/video"} <= prefixes
    operations = [m for ops in app.openapi()["paths"].values() for m in ops]
    assert len(operations) == 48   # the 45 endpoints the single main.py had, the real-match search and replay, video reading


def test_forge_generate_rejects_unknown_teams(client):
    r = client.post("/api/forge/generate", json={"home_team_id": "atlantis", "away_team_id": "england"})
    assert r.status_code == 400 and r.json()["detail"] == "Unknown team id"


def test_memo_computes_once_and_does_not_cache_failures():
    from app.services.memo import Memo
    memo: Memo[int] = Memo()
    calls = []

    async def compute():
        calls.append(1)
        return 42

    async def fail():
        raise RuntimeError("engine down")

    async def scenario():
        assert await memo.get("k", compute) == 42
        assert await memo.get("k", compute) == 42
        with pytest.raises(RuntimeError):
            await memo.get("bad", fail)
        assert "k" in memo and "bad" not in memo
        memo.clear()
        assert "k" not in memo

    asyncio.run(scenario())
    assert len(calls) == 1
