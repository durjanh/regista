"""Agent runtime: Microsoft Agent Framework agents on Microsoft Foundry, with graceful fallbacks.

Modes, chosen automatically:
- "agent_framework": FOUNDRY_PROJECT_ENDPOINT is set. Agents are `agent_framework.Agent`s on a `FoundryChatClient`;
  parallel analysis uses `ConcurrentBuilder`; the Ask agent consumes the Regista MCP server via `MCPStreamableHTTPTool`.
- "openai": only AZURE_OPENAI_ENDPOINT is set. The same agents run as plain chat completions with function calling.
- "offline": no Azure AI configured. Callers use the deterministic offline engine.

Every run returns an agent trace (agent, action, ms) that the UI shows, so judges and producers can see who did what.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field

from ..config import settings
from . import clients
from .tools import READ_ONLY_TOOLS, call_tool, openai_tool_specs

log = logging.getLogger("regista.agents")


@dataclass
class AgentSpec:
    name: str
    instructions: str
    tools: bool = False          # give the agent the match-intelligence tools
    deployment: str | None = None


@dataclass
class AgentResult:
    text: str
    trace: list[dict] = field(default_factory=list)
    tool_calls: list[dict] = field(default_factory=list)


def mode() -> str:
    if settings.agents:
        return "agent_framework"
    if settings.llm:
        return "openai"
    return "offline"


_client = None


def _foundry_client(deployment: str | None = None):
    global _client
    from agent_framework.foundry import FoundryChatClient
    if deployment and deployment != settings.chat_deployment:
        return FoundryChatClient(project_endpoint=settings.foundry_project_endpoint, model=deployment,
                                 credential=clients.sync_credential())
    if _client is None:
        _client = FoundryChatClient(project_endpoint=settings.foundry_project_endpoint, model=settings.chat_deployment,
                                    credential=clients.sync_credential())
    return _client


def _extract_tool_calls(response) -> list[dict]:
    calls = []
    for msg in getattr(response, "messages", []) or []:
        for c in getattr(msg, "contents", []) or []:
            ctype = getattr(c, "type", "") or c.__class__.__name__.lower()
            if "function_call" in str(ctype) and getattr(c, "name", None):
                args = getattr(c, "arguments", {}) or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except json.JSONDecodeError:
                        args = {"raw": args}
                calls.append({"tool": c.name, "args": args, "ms": 0})
    return calls


async def run(spec: AgentSpec, prompt: str, *, json_mode: bool = False, use_mcp: bool = False, max_tokens: int = 1200) -> AgentResult:
    t0 = time.perf_counter()
    m = mode()
    if m == "agent_framework":
        try:
            return await _run_af(spec, prompt, use_mcp=use_mcp, t0=t0)
        except Exception as exc:  # fall back to direct model calls rather than failing the request
            log.warning("Agent Framework run failed for %s, falling back to OpenAI: %s", spec.name, exc)
    if m in ("agent_framework", "openai"):
        return await _run_openai(spec, prompt, json_mode=json_mode, max_tokens=max_tokens, t0=t0)
    raise RuntimeError("No AI backend configured")


async def _run_af(spec: AgentSpec, prompt: str, *, use_mcp: bool, t0: float) -> AgentResult:
    from agent_framework import Agent
    client = _foundry_client(spec.deployment)
    if spec.tools and use_mcp:
        from agent_framework import MCPStreamableHTTPTool
        async with MCPStreamableHTTPTool(name="regista", url=settings.mcp_url, description="Regista match intelligence") as mcp:
            agent = Agent(client=client, name=spec.name, instructions=spec.instructions, tools=mcp)
            response = await agent.run(prompt)
    else:
        tools = list(READ_ONLY_TOOLS) if spec.tools else None
        agent = Agent(client=client, name=spec.name, instructions=spec.instructions, tools=tools)
        response = await agent.run(prompt)
    ms = int((time.perf_counter() - t0) * 1000)
    calls = _extract_tool_calls(response)
    from .. import ops
    usage = getattr(response, "usage_details", None)
    ops.record_usage(getattr(usage, "input_token_count", 0), getattr(usage, "output_token_count", 0))
    trace = [{"agent": spec.name, "action": "agent_framework.run" + (" + MCP tools" if use_mcp and spec.tools else ""), "ms": ms}]
    trace += [{"agent": spec.name, "action": f"tool: {c['tool']}", "ms": 0, "detail": json.dumps(c["args"])[:200]} for c in calls]
    return AgentResult(text=response.text or "", trace=trace, tool_calls=calls)


async def _run_openai(spec: AgentSpec, prompt: str, *, json_mode: bool, max_tokens: int, t0: float) -> AgentResult:
    messages = [{"role": "system", "content": spec.instructions}, {"role": "user", "content": prompt}]
    tool_calls_log, trace = [], []
    specs = openai_tool_specs() if spec.tools else None
    for _ in range(6):
        resp = await clients.chat(messages, deployment=spec.deployment, json_mode=json_mode and not specs, max_tokens=max_tokens, tools=specs)
        msg = resp.choices[0].message
        if getattr(msg, "tool_calls", None):
            messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [tc.model_dump() for tc in msg.tool_calls]})
            for tc in msg.tool_calls:
                ts = time.perf_counter()
                args = json.loads(tc.function.arguments or "{}")
                result = await asyncio.to_thread(call_tool, tc.function.name, args)
                ms = int((time.perf_counter() - ts) * 1000)
                tool_calls_log.append({"tool": tc.function.name, "args": args, "ms": ms, "result": result})
                trace.append({"agent": spec.name, "action": f"tool: {tc.function.name}", "ms": ms, "detail": json.dumps(args)[:200]})
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, default=str)[:12000]})
            continue
        ms = int((time.perf_counter() - t0) * 1000)
        trace.insert(0, {"agent": spec.name, "action": "azure_openai.chat", "ms": ms})
        return AgentResult(text=msg.content or "", trace=trace, tool_calls=tool_calls_log)
    return AgentResult(text="", trace=trace, tool_calls=tool_calls_log)


async def run_concurrent(specs: list[AgentSpec], prompt: str) -> list[AgentResult]:
    """Fan the same task out to several specialist agents in parallel (Agent Framework ConcurrentBuilder when available)."""
    t0 = time.perf_counter()
    if mode() == "agent_framework":
        try:
            from agent_framework import Agent
            from agent_framework.orchestrations import ConcurrentBuilder
            agents = [Agent(client=_foundry_client(s.deployment), name=s.name, instructions=s.instructions,
                            tools=list(READ_ONLY_TOOLS) if s.tools else None) for s in specs]
            workflow = ConcurrentBuilder(participants=agents).build()
            result = await workflow.run(prompt)
            texts = _workflow_texts(result, [s.name for s in specs])
            ms = int((time.perf_counter() - t0) * 1000)
            if len(texts) == len(specs):
                return [AgentResult(text=t, trace=[{"agent": s.name, "action": "ConcurrentBuilder participant", "ms": ms}])
                        for s, t in zip(specs, texts)]
        except Exception as exc:
            log.warning("ConcurrentBuilder failed, running agents with asyncio.gather: %s", exc)
    return list(await asyncio.gather(*(run(s, prompt) for s in specs)))


def _workflow_texts(result, names: list[str]) -> list[str]:
    outputs = result.get_outputs() if hasattr(result, "get_outputs") else []
    texts: list[str] = []
    for out in outputs:
        msgs = getattr(out, "messages", None)
        if msgs is None and isinstance(out, list):
            msgs = out
        if msgs:
            for msg in msgs:
                role = str(getattr(msg, "role", ""))
                if "assistant" in role.lower() and getattr(msg, "text", ""):
                    texts.append(msg.text)
        elif getattr(out, "text", None):
            texts.append(out.text)
    return texts[-len(names):] if len(texts) >= len(names) else texts
