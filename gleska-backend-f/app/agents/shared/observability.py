from __future__ import annotations

from typing import Any, Protocol

from app.agents.shared.contracts import AgentExecutionContext


class AgentObserver(Protocol):
    def on_agent_start(self, context: AgentExecutionContext, **metadata: Any) -> None: ...
    def on_agent_complete(self, context: AgentExecutionContext, **metadata: Any) -> None: ...
    def on_agent_error(self, context: AgentExecutionContext, exc: Exception, **metadata: Any) -> None: ...
    def on_llm_start(self, context: AgentExecutionContext, **metadata: Any) -> None: ...
    def on_llm_complete(self, context: AgentExecutionContext, **metadata: Any) -> None: ...
    def on_tool_requested(self, context: AgentExecutionContext, tool_name: str, **metadata: Any) -> None: ...
    def on_tool_result(self, context: AgentExecutionContext, tool_name: str, **metadata: Any) -> None: ...

    def on_tool_start(self, context: AgentExecutionContext, tool_name: str, **metadata: Any) -> None: ...
    def on_tool_complete(self, context: AgentExecutionContext, tool_name: str, **metadata: Any) -> None: ...


class NoopObserver:
    def on_agent_start(self, context: AgentExecutionContext, **metadata: Any) -> None:
        return None

    def on_agent_complete(self, context: AgentExecutionContext, **metadata: Any) -> None:
        return None

    def on_agent_error(self, context: AgentExecutionContext, exc: Exception, **metadata: Any) -> None:
        return None

    def on_llm_start(self, context: AgentExecutionContext, **metadata: Any) -> None:
        return None

    def on_llm_complete(self, context: AgentExecutionContext, **metadata: Any) -> None:
        return None

    def on_tool_requested(self, context: AgentExecutionContext, tool_name: str, **metadata: Any) -> None:
        return None

    def on_tool_result(self, context: AgentExecutionContext, tool_name: str, **metadata: Any) -> None:
        return None

    def on_tool_start(self, context: AgentExecutionContext, tool_name: str, **metadata: Any) -> None:
        return None

    def on_tool_complete(self, context: AgentExecutionContext, tool_name: str, **metadata: Any) -> None:
        return None
