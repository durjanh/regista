"""Match-intelligence tools shared by the MCP server, the Agent Framework agents and the OpenAI tool loop.

Each tool returns compact, citation-ready JSON: numbers come straight from the analytics engine or the real results
dataset, never from a model. Tools live in one module per area and register themselves (`@tool`) with the registry.
"""

from __future__ import annotations

# Importing the modules registers their tools, in this order (MCP lists them in registration order): match first,
# the state-changing Data Forge tool last.
# isort: off
from . import match, reference, scouting, forge  # noqa: F401  (side effect: registration)
# isort: on
from .forge import generate_what_if
from .match import (
    compare_periods,
    explain_moment,
    get_key_moments,
    get_match_state,
    get_player_stats,
    get_tactical_summary,
    get_xg_breakdown,
    list_matches,
)
from .reference import get_head_to_head, get_team_history
from .registry import ToolRegistry, registry, tool
from .scouting import get_dugout_advice, get_player_dna, get_team_report

TOOLS = registry.all()
READ_ONLY_TOOLS = registry.read_only()


def openai_tool_specs(tools=None) -> list[dict]:
    """OpenAI function-calling specs derived from the tool signatures (default: the read-only tools)."""
    return registry.openai_specs(tools)


def call_tool(name: str, args: dict):
    return registry.call(name, args)


__all__ = ["TOOLS", "READ_ONLY_TOOLS", "ToolRegistry", "call_tool", "openai_tool_specs", "registry", "tool",
           "compare_periods", "explain_moment", "generate_what_if", "get_dugout_advice", "get_head_to_head", "get_key_moments",
           "get_match_state", "get_player_dna", "get_player_stats", "get_tactical_summary", "get_team_history",
           "get_team_report", "get_xg_breakdown", "list_matches"]
