"""Regista MCP server (streamable HTTP at /mcp).

The same match-intelligence tools our own agents use are exposed over the Model Context Protocol, so any MCP
client (GitHub Copilot agent mode in VS Code, Foundry agents, a broadcaster's own assistant) can query the
engine: "why did England concede the second?" becomes explain_moment(...) with evidence.
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from .ai.tools import TOOLS

mcp = FastMCP(
    "regista",
    instructions=("Explainable football match intelligence. Matches are real international results rebuilt as synthetic "
                  "event data, plus what-if matches. Start with list_matches, then get_match_state / get_key_moments / "
                  "explain_moment. Every number comes from the analytics engine or the real results dataset."),
    stateless_http=True,
    json_response=True,
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)

for fn in TOOLS:
    mcp.add_tool(fn)


@mcp.resource("regista://matches")
def matches_resource() -> str:
    """All available matches as JSON."""
    import json

    from .ai.tools import list_matches
    return json.dumps(list_matches())
