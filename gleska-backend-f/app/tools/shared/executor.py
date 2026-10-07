from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from jsonschema import Draft202012Validator, SchemaError

from app.agents.shared.authorization import authorize_agent_context
from app.agents.shared.contracts import AgentExecutionContext
from app.agents.shared.runtime import RequestedToolCall
from app.agents.shared.task import (
    ConfirmationState,
    ConfirmationStatus,
    ExecutionState,
    ExecutionStatus,
    PendingAction,
)
from app.tools.shared.contracts import ToolDefinition, ToolExecutionResult
from app.tools.shared.registry import ToolRegistry

logger = logging.getLogger(__name__)

ToolHandler = Callable[
    [dict[str, Any], AgentExecutionContext],
    Awaitable[Any],
]


@dataclass
class _ExecutionRecord:
    fingerprint: str
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    result: ToolExecutionResult | None = None
    updated_at: float = field(default_factory=time.monotonic)


class ToolExecutor:
    """Validates and dispatches calls only to explicitly registered trusted handlers.

    Idempotency records are process-local and expire; they do not protect against
    duplicate side effects across workers, restarts, or after record expiration.
    """

    def __init__(
        self,
        registry: ToolRegistry,
        *,
        timeout_seconds: float = 30.0,
        confirmation_ttl_seconds: int = 300,
        idempotency_retention_seconds: int = 86_400,
        max_idempotency_records: int = 10_000,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero")
        if confirmation_ttl_seconds <= 0:
            raise ValueError("confirmation_ttl_seconds must be greater than zero")
        if idempotency_retention_seconds <= 0:
            raise ValueError("idempotency_retention_seconds must be greater than zero")
        if max_idempotency_records <= 0:
            raise ValueError("max_idempotency_records must be greater than zero")

        self._registry = registry
        self._timeout_seconds = timeout_seconds
        self._confirmation_ttl_seconds = confirmation_ttl_seconds
        self._idempotency_retention_seconds = idempotency_retention_seconds
        self._max_idempotency_records = max_idempotency_records
        self._handlers: dict[str, ToolHandler] = {}
        self._records: OrderedDict[tuple[str, str, str], _ExecutionRecord] = OrderedDict()
        self._records_lock = asyncio.Lock()

    def register_handler(self, tool_name: str, handler: ToolHandler) -> None:
        """Bind trusted application code to an already registered tool definition."""
        tool = self._registry.get(tool_name)
        if tool is None:
            raise ValueError("TOOL_NOT_REGISTERED")
        if tool_name in self._handlers:
            raise ValueError("TOOL_HANDLER_ALREADY_REGISTERED")
        if not callable(handler) or not self._is_async_handler(handler):
            raise TypeError("Tool handlers must be trusted async callables")

        try:
            Draft202012Validator.check_schema(tool.input_schema)
            if tool.output_schema:
                Draft202012Validator.check_schema(tool.output_schema)
        except SchemaError as exc:
            raise ValueError("TOOL_SCHEMA_INVALID") from exc
        self._handlers[tool_name] = handler

    async def execute(
        self,
        tool_call: RequestedToolCall,
        context: AgentExecutionContext,
        *,
        confirmation: ConfirmationState | None = None,
    ) -> ToolExecutionResult:
        execution_id = tool_call.call_id
        tool = self._registry.get(tool_call.tool_name)
        if tool is None:
            return self._failure(
                tool_call.tool_name,
                "UNKNOWN_TOOL",
                "The requested tool is not registered.",
                execution_id=execution_id,
                tool_error=True,
            )
        if not tool.enabled:
            return self._failure(
                tool.name,
                "TOOL_DISABLED",
                "The requested tool is disabled.",
                execution_id=execution_id,
                tool_error=True,
            )

        try:
            errors = self._validate_arguments(tool.input_schema, tool_call.arguments)
        except SchemaError:
            return self._failure(
                tool.name,
                "TOOL_SCHEMA_INVALID",
                "The registered tool schema is invalid.",
                execution_id=execution_id,
                tool_error=True,
            )
        if errors:
            return self._failure(
                tool.name,
                "ARGUMENT_VALIDATION_FAILED",
                "Tool arguments do not match the registered input schema.",
                execution_id=execution_id,
                validation_error=True,
                metadata={"validation_errors": errors},
            )

        if not context.user_id:
            return self._failure(
                tool.name,
                "AUTHORIZATION_FAILED",
                "An authenticated user context is required.",
                execution_id=execution_id,
                authorization_error=True,
            )
        if tool.agent_id != context.agent_id:
            return self._failure(
                tool.name,
                "AUTHORIZATION_FAILED",
                "The tool is not available to this agent.",
                execution_id=execution_id,
                authorization_error=True,
            )
        try:
            authorize_agent_context(
                context,
                required_roles=tool.required_roles,
                required_permissions=tool.required_permissions,
            )
        except PermissionError:
            return self._failure(
                tool.name,
                "AUTHORIZATION_FAILED",
                "The current user is not authorized to use this tool.",
                execution_id=execution_id,
                authorization_error=True,
            )

        handler = self._handlers.get(tool.name)
        if handler is None:
            return self._failure(
                tool.name,
                "TOOL_HANDLER_NOT_REGISTERED",
                "No trusted implementation is registered for this tool.",
                execution_id=execution_id,
                tool_error=True,
            )

        try:
            fingerprint = self._fingerprint(tool.name, tool_call.arguments)
        except (TypeError, ValueError):
            return self._failure(
                tool.name,
                "ARGUMENTS_NOT_JSON_SERIALIZABLE",
                "Tool arguments must contain JSON-compatible values.",
                execution_id=execution_id,
                validation_error=True,
            )

        key = (context.user_id, context.agent_id, execution_id)
        try:
            record, conflict = await self._get_or_create_record(key, fingerprint)
        except RuntimeError:
            return self._failure(
                tool.name,
                "IDEMPOTENCY_CAPACITY_REACHED",
                "The executor cannot accept another tracked execution right now.",
                execution_id=execution_id,
                tool_error=True,
            )
        if conflict:
            return self._failure(
                tool.name,
                "EXECUTION_ID_CONFLICT",
                "This execution ID was already used for a different request.",
                execution_id=execution_id,
                validation_error=True,
            )

        async with record.lock:
            if record.result is not None:
                record.updated_at = time.monotonic()
                return self._replayed(record.result)

            if tool.confirmation_required:
                confirmation_result = self._check_confirmation(
                    tool,
                    tool_call,
                    context,
                    confirmation,
                )
                if confirmation_result is not None:
                    return confirmation_result

            execution_state = ExecutionState(execution_id=execution_id).transition_to(
                ExecutionStatus.RUNNING
            )
            try:
                handler_result = await asyncio.wait_for(
                    handler(dict(tool_call.arguments), context),
                    timeout=self._timeout_seconds,
                )
            except asyncio.TimeoutError:
                execution_state = execution_state.transition_to(ExecutionStatus.TIMED_OUT)
                result = self._failure(
                    tool.name,
                    "TOOL_EXECUTION_TIMEOUT",
                    "Tool execution exceeded its time limit.",
                    execution_id=execution_id,
                    tool_error=True,
                    execution_state=execution_state,
                )
            except asyncio.CancelledError:
                execution_state = execution_state.transition_to(ExecutionStatus.CANCELLED)
                record.result = self._failure(
                    tool.name,
                    "TOOL_EXECUTION_CANCELLED",
                    "Tool execution was cancelled.",
                    execution_id=execution_id,
                    tool_error=True,
                    execution_state=execution_state,
                )
                record.updated_at = time.monotonic()
                raise
            except Exception as exc:
                execution_state = execution_state.transition_to(ExecutionStatus.FAILED)
                logger.warning(
                    "Tool handler failed: tool=%s execution_id=%s exception_type=%s",
                    tool.name,
                    execution_id,
                    type(exc).__name__,
                )
                result = self._failure(
                    tool.name,
                    "TOOL_EXECUTION_FAILED",
                    "The tool could not complete the requested operation.",
                    execution_id=execution_id,
                    tool_error=True,
                    execution_state=execution_state,
                )
            else:
                execution_state = execution_state.transition_to(ExecutionStatus.SUCCEEDED)
                result = ToolExecutionResult(
                    success=True,
                    tool_name=tool.name,
                    data=handler_result,
                    execution_id=execution_id,
                    execution_state=execution_state,
                    metadata={"idempotency_scope": "process_memory"},
                )

            record.result = result
            record.updated_at = time.monotonic()
            return result

    def _check_confirmation(
        self,
        tool: ToolDefinition,
        tool_call: RequestedToolCall,
        context: AgentExecutionContext,
        confirmation: ConfirmationState | None,
    ) -> ToolExecutionResult | None:
        now = datetime.now(timezone.utc)
        pending_action = PendingAction(
            action_id=tool_call.call_id,
            action_name=tool.name,
            input=dict(tool_call.arguments),
            reason=f"Tool '{tool.name}' requires explicit confirmation.",
            confirmation_required=True,
            expires_at=now + timedelta(seconds=self._confirmation_ttl_seconds),
        )

        if confirmation is None or confirmation.status == ConfirmationStatus.PENDING:
            return self._failure(
                tool.name,
                "CONFIRMATION_REQUIRED",
                "Explicit confirmation is required before this tool can execute.",
                execution_id=tool_call.call_id,
                pending_action=pending_action,
                confirmation_required=True,
            )
        if confirmation.status == ConfirmationStatus.REJECTED:
            return self._failure(
                tool.name,
                "CONFIRMATION_REJECTED",
                "The requested action was not confirmed.",
                execution_id=tool_call.call_id,
                confirmation_required=True,
            )
        if confirmation.status == ConfirmationStatus.EXPIRED:
            return self._failure(
                tool.name,
                "CONFIRMATION_EXPIRED",
                "The requested confirmation has expired.",
                execution_id=tool_call.call_id,
                confirmation_required=True,
            )
        if (
            confirmation.status != ConfirmationStatus.CONFIRMED
            or confirmation.action_id != tool_call.call_id
            or confirmation.resolved_by != context.user_id
        ):
            return self._failure(
                tool.name,
                "CONFIRMATION_INVALID",
                "Confirmation does not match this action and user.",
                execution_id=tool_call.call_id,
                pending_action=pending_action,
                confirmation_required=True,
            )
        if confirmation.expires_at is not None and confirmation.expires_at <= now:
            return self._failure(
                tool.name,
                "CONFIRMATION_EXPIRED",
                "The requested confirmation has expired.",
                execution_id=tool_call.call_id,
                confirmation_required=True,
            )
        return None

    async def _get_or_create_record(
        self,
        key: tuple[str, str, str],
        fingerprint: str,
    ) -> tuple[_ExecutionRecord, bool]:
        async with self._records_lock:
            self._prune_records()
            existing = self._records.get(key)
            if existing is not None:
                self._records.move_to_end(key)
                return existing, existing.fingerprint != fingerprint

            while len(self._records) >= self._max_idempotency_records:
                removable_key = next(
                    (
                        record_key
                        for record_key, record in self._records.items()
                        if record.result is not None and not record.lock.locked()
                    ),
                    None,
                )
                if removable_key is None:
                    raise RuntimeError("IDEMPOTENCY_CAPACITY_REACHED")
                self._records.pop(removable_key)

            record = _ExecutionRecord(fingerprint=fingerprint)
            self._records[key] = record
            return record, False

    def _prune_records(self) -> None:
        cutoff = time.monotonic() - self._idempotency_retention_seconds
        expired = [
            key
            for key, record in self._records.items()
            if record.result is not None
            and not record.lock.locked()
            and record.updated_at <= cutoff
        ]
        for key in expired:
            self._records.pop(key, None)

    @staticmethod
    def _validate_arguments(schema: dict[str, Any], arguments: dict[str, Any]) -> list[dict[str, Any]]:
        validator = Draft202012Validator(schema)
        errors: list[dict[str, Any]] = []
        for error in sorted(
            validator.iter_errors(arguments),
            key=lambda item: tuple(str(part) for part in item.absolute_path),
        ):
            path = ".".join(str(part) for part in error.absolute_path) or "$"
            errors.append({
                "path": path,
                "reason": f"Invalid value at {path} ({error.validator or 'schema'})",
                "keyword": str(error.validator or "schema"),
            })
        return errors

    @staticmethod
    def _fingerprint(tool_name: str, arguments: dict[str, Any]) -> str:
        canonical = json.dumps(
            {"tool_name": tool_name, "arguments": arguments},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    @staticmethod
    def _is_async_handler(handler: Callable[..., Any]) -> bool:
        return inspect.iscoroutinefunction(handler) or inspect.iscoroutinefunction(
            getattr(handler, "__call__", None)
        )

    @staticmethod
    def _replayed(result: ToolExecutionResult) -> ToolExecutionResult:
        return ToolExecutionResult(
            success=result.success,
            tool_name=result.tool_name,
            data=result.data,
            error_code=result.error_code,
            message=result.message,
            validation_error=result.validation_error,
            authorization_error=result.authorization_error,
            tool_error=result.tool_error,
            domain_error=result.domain_error,
            unexpected_error=result.unexpected_error,
            metadata={**result.metadata, "replayed": True},
            execution_id=result.execution_id,
            execution_state=result.execution_state,
            pending_action=result.pending_action,
            replayed=True,
            idempotency_scope=result.idempotency_scope,
        )

    @staticmethod
    def _failure(
        tool_name: str,
        error_code: str,
        message: str,
        *,
        execution_id: str | None = None,
        validation_error: bool = False,
        authorization_error: bool = False,
        tool_error: bool = False,
        confirmation_required: bool = False,
        execution_state: ExecutionState | None = None,
        pending_action: PendingAction | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ToolExecutionResult:
        return ToolExecutionResult(
            success=False,
            tool_name=tool_name,
            error_code=error_code,
            message=message,
            validation_error=validation_error,
            authorization_error=authorization_error,
            tool_error=tool_error,
            metadata={
                **(metadata or {}),
                "confirmation_required": confirmation_required,
                "idempotency_scope": "process_memory",
            },
            execution_id=execution_id,
            execution_state=execution_state
            or ExecutionState(
                execution_id=execution_id,
                status=ExecutionStatus.NOT_STARTED,
            ),
            pending_action=pending_action,
        )
