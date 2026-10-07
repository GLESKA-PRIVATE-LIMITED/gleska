"""Shared tool contracts and registry."""

from app.tools.shared.contracts import ToolDefinition, ToolExecutionResult
from app.tools.shared.registry import ToolRegistry, default_tool_registry

__all__ = [
    "ToolDefinition",
    "ToolExecutor",
    "ToolExecutionResult",
    "ToolRegistry",
    "default_tool_registry",
]


def __getattr__(name: str):
    if name == "ToolExecutor":
        from app.tools.shared.executor import ToolExecutor

        return ToolExecutor
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
