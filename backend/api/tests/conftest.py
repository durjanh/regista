"""Shared fixtures: offline by default, a loaded match store, and a switch that turns on "Azure mode" with fakes."""

from __future__ import annotations

import dataclasses
import os
import pathlib
import re
import sys

import pytest

# Hermetic tests: neither a developer's .env nor a pipeline's variable group (exported as environment variables) may
# reach the app. Clear every variable the settings read (app/config.py is the list) before anything imports the app;
# none of the imports above loads it.
_CONFIG = pathlib.Path(__file__).resolve().parents[1] / "app" / "config.py"
for _name in set(re.findall(r'_env(?:_int|_float)?\("([A-Z0-9_]+)"', _CONFIG.read_text())) - {"REGISTA_OFFLINE"}:
    os.environ.pop(_name, None)
os.environ["REGISTA_DOTENV"] = "0"
os.environ.setdefault("REGISTA_OFFLINE", "1")

HERO = "2026-07-15-england-argentina"


@pytest.fixture(scope="session")
def loaded_store():
    from app.store import store
    if not store.docs:
        store.load()
    return store


@pytest.fixture
def azure(monkeypatch):
    """Return a function that swaps the settings object seen by every loaded app module for one with Azure configured.

    Endpoints point at fake hosts; tests patch the SDK clients and HTTP calls, so nothing leaves the machine.
    """
    from app import config

    def enable(**overrides):
        values = {"force_offline": False, "openai_endpoint": "https://fake-openai.example", "ai_services_endpoint": "https://fake-ai.example",
                  "ai_services_region": "uksouth", "ai_services_resource_id": "/subscriptions/x/resourceGroups/y/providers/z/accounts/a"}
        values.update(overrides)
        new = dataclasses.replace(config.settings, **values)
        for name, mod in list(sys.modules.items()):
            if name == "app" or name.startswith("app."):
                if getattr(mod, "settings", None) is config.settings or isinstance(getattr(mod, "settings", None), config.Settings):
                    monkeypatch.setattr(mod, "settings", new)
        return new

    return enable


class FakeResult:
    """Stand-in for agents.AgentResult."""

    def __init__(self, text: str, tool_calls: list | None = None):
        self.text = text
        self.trace = [{"agent": "fake", "action": "run", "ms": 1}]
        self.tool_calls = tool_calls or []


@pytest.fixture
def fake_agents(monkeypatch):
    """Script agents.run / run_concurrent: `script` maps an agent name to a reply (str, callable or exception)."""
    from app.ai import agents

    script: dict = {}
    calls: list[tuple[str, str]] = []

    async def run(spec, prompt, **_kw):
        calls.append((spec.name, prompt))
        reply = script.get(spec.name, "")
        if isinstance(reply, list):
            reply = reply.pop(0) if len(reply) > 1 else reply[0]
        if isinstance(reply, BaseException):
            raise reply
        if callable(reply):
            reply = reply(prompt)
        return reply if isinstance(reply, FakeResult) else FakeResult(reply)

    async def run_concurrent(specs, prompt):
        return [await run(s, prompt) for s in specs]

    monkeypatch.setattr(agents, "run", run)
    monkeypatch.setattr(agents, "run_concurrent", run_concurrent)
    monkeypatch.setattr(agents, "mode", lambda: "openai")
    return script, calls
