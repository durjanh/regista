"""The tool registry: tools register themselves, consumers read them, and a failing tool never crashes an agent."""

from __future__ import annotations

from typing import Annotated

import pytest


def test_a_new_tool_needs_only_a_decorator():
    from app.ai.tools import ToolRegistry
    reg = ToolRegistry()

    @reg.tool()
    def count_goals(match_id: Annotated[str, "Match id"], half: Annotated[int | None, "1 or 2"] = None) -> dict:
        """Goals in a match."""
        return {"match_id": match_id, "goals": 3}

    @reg.tool(read_only=False)
    def reset_match(match_id: str) -> dict:
        """Changes state."""
        raise RuntimeError("boom")

    assert reg.all() == [count_goals, reset_match] and reg.read_only() == [count_goals]
    assert reg.call("count_goals", {"match_id": "m1"}) == {"match_id": "m1", "goals": 3}
    assert reg.call("reset_match", {"match_id": "m1"}) == {"error": "boom"}          # never crashes the agent run
    assert reg.call("missing", {}) == {"error": "unknown tool missing"}
    (spec,) = reg.openai_specs()                                                       # read-only by default
    fn = spec["function"]
    assert fn["name"] == "count_goals" and fn["description"] == "Goals in a match."
    assert fn["parameters"]["properties"] == {"match_id": {"type": "string", "description": "Match id"},
                                              "half": {"type": "integer", "description": "1 or 2"}}
    assert fn["parameters"]["required"] == ["match_id"]


def test_duplicate_tool_names_are_rejected():
    from app.ai.tools import ToolRegistry
    reg = ToolRegistry()

    @reg.tool()
    def same() -> None:
        """One."""

    with pytest.raises(ValueError, match="already registered"):
        reg.tool()(same)


def test_the_shared_registry_holds_every_tool_once_with_data_forge_last():
    from app.ai import tools
    names = [f.__name__ for f in tools.TOOLS]
    assert len(names) == len(set(names)) == 14
    assert names[0] == "list_matches" and names[-1] == "generate_what_if"
    assert "generate_what_if" not in [f.__name__ for f in tools.READ_ONLY_TOOLS]   # agents can't change state
    assert {f.__module__.rsplit(".", 1)[-1] for f in tools.TOOLS} == {"match", "reference", "scouting", "forge"}
