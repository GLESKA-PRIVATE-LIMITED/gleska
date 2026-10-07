from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from app.tools.shared.contracts import ToolDefinition


@dataclass
class ToolRegistry:
    """Deterministic registry for service-backed tools."""

    _tools: dict[str, ToolDefinition] = field(default_factory=dict)

    def register(self, tool: ToolDefinition) -> ToolDefinition:
        tool_name = (tool.name or "").strip()
        if not tool_name:
            raise ValueError("TOOL_NAME_REQUIRED")
        if tool_name in self._tools:
            raise ValueError(f"Tool '{tool_name}' is already registered")
        self._tools[tool_name] = tool
        return tool

    def get(self, tool_name: str) -> ToolDefinition | None:
        return self._tools.get((tool_name or "").strip())

    def list(self, agent_id: str | None = None, domain: str | None = None) -> list[ToolDefinition]:
        tools = list(self._tools.values())
        if agent_id:
            tools = [tool for tool in tools if tool.agent_id == agent_id]
        if domain:
            tools = [tool for tool in tools if tool.domain == domain]
        return tools


default_tool_registry = ToolRegistry()
