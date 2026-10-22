"""The tool registry: tools register themselves with `@tool`, and every consumer (the MCP server, the Agent Framework
agents, the OpenAI tool loop) reads them from here. Adding a tool never means editing a list.

Tools stay plain functions on purpose: MCP, Agent Framework and the OpenAI specs all build the schema the model sees
from the function's name, `Annotated` parameter descriptions and docstring.
"""

from __future__ import annotations

import inspect
import typing
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeVar

F = TypeVar("F", bound=Callable[..., Any])


@dataclass(frozen=True)
class RegisteredTool:
    fn: Callable[..., Any]
    read_only: bool

    @property
    def name(self) -> str:
        return self.fn.__name__


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: list[RegisteredTool] = []

    def tool(self, *, read_only: bool = True) -> Callable[[F], F]:
        """Register a tool. `read_only=False` marks one that changes state (the agents only get read-only tools)."""
        def register(fn: F) -> F:
            if any(t.name == fn.__name__ for t in self._tools):
                raise ValueError(f"Tool {fn.__name__} is already registered")
            self._tools.append(RegisteredTool(fn, read_only))
            return fn
        return register

    def all(self) -> list[Callable[..., Any]]:
        return [t.fn for t in self._tools]

    def read_only(self) -> list[Callable[..., Any]]:
        return [t.fn for t in self._tools if t.read_only]

    def get(self, name: str) -> Callable[..., Any] | None:
        return next((t.fn for t in self._tools if t.name == name), None)

    def call(self, name: str, args: dict) -> Any:
        """Run a tool by name. Tools must never crash an agent run: any failure comes back as {"error": ...}."""
        fn = self.get(name)
        if not fn:
            return {"error": f"unknown tool {name}"}
        try:
            return fn(**args)
        except Exception as exc:
            return {"error": str(exc)}

    def openai_specs(self, tools: list[Callable[..., Any]] | None = None) -> list[dict]:
        """OpenAI function-calling specs derived from the tool signatures (default: the read-only tools)."""
        return [_openai_spec(fn) for fn in (self.read_only() if tools is None else tools)]


def _openai_spec(fn: Callable[..., Any]) -> dict:
    sig = inspect.signature(fn)
    hints = typing.get_type_hints(fn, include_extras=True)
    props, required = {}, []
    for name, param in sig.parameters.items():
        hint = hints.get(name, str)
        desc = ""
        base = hint
        if typing.get_origin(hint) is typing.Annotated:
            base, desc = typing.get_args(hint)[0], typing.get_args(hint)[1]
        args = typing.get_args(base)
        base_t = next((a for a in args if a is not type(None)), base) if args else base
        js = "integer" if base_t is int else "number" if base_t is float else "string"
        props[name] = {"type": js, "description": desc}
        if param.default is inspect.Parameter.empty:
            required.append(name)
    return {"type": "function", "function": {"name": fn.__name__, "description": (fn.__doc__ or "").strip(),
                                             "parameters": {"type": "object", "properties": props, "required": required}}}


registry = ToolRegistry()
tool = registry.tool
