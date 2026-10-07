from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Mapping

from pydantic import BaseModel, ConfigDict, Field


class TaskStatus(str, Enum):
    """Generic task lifecycle states and supported transitions.

    ACTIVE can wait for input or confirmation, execute, finish, fail, or cancel.
    Waiting states can resume, wait for confirmation, fail, or cancel as
    applicable. EXECUTING can finish, fail, cancel, or return to ACTIVE.
    FAILED may be explicitly restarted as ACTIVE. COMPLETED and CANCELLED
    are terminal.
    """

    ACTIVE = "ACTIVE"
    WAITING_FOR_INPUT = "WAITING_FOR_INPUT"
    WAITING_FOR_CONFIRMATION = "WAITING_FOR_CONFIRMATION"
    EXECUTING = "EXECUTING"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


_TASK_TRANSITIONS: dict[TaskStatus, frozenset[TaskStatus]] = {
    TaskStatus.ACTIVE: frozenset({
        TaskStatus.WAITING_FOR_INPUT,
        TaskStatus.WAITING_FOR_CONFIRMATION,
        TaskStatus.EXECUTING,
        TaskStatus.COMPLETED,
        TaskStatus.CANCELLED,
        TaskStatus.FAILED,
    }),
    TaskStatus.WAITING_FOR_INPUT: frozenset({
        TaskStatus.ACTIVE,
        TaskStatus.WAITING_FOR_CONFIRMATION,
        TaskStatus.CANCELLED,
        TaskStatus.FAILED,
    }),
    TaskStatus.WAITING_FOR_CONFIRMATION: frozenset({
        TaskStatus.ACTIVE,
        TaskStatus.EXECUTING,
        TaskStatus.CANCELLED,
        TaskStatus.FAILED,
    }),
    TaskStatus.EXECUTING: frozenset({
        TaskStatus.ACTIVE,
        TaskStatus.COMPLETED,
        TaskStatus.CANCELLED,
        TaskStatus.FAILED,
    }),
    TaskStatus.FAILED: frozenset({TaskStatus.ACTIVE}),
    TaskStatus.COMPLETED: frozenset(),
    TaskStatus.CANCELLED: frozenset(),
}


class _TaskModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class AgentTask(_TaskModel):
    task_id: str = Field(min_length=1)
    task_type: str = Field(min_length=1)
    status: TaskStatus = TaskStatus.ACTIVE
    revision: int = Field(default=0, ge=0)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: dict[str, Any] = Field(default_factory=dict)

    def transition_to(self, status: TaskStatus) -> AgentTask:
        status = TaskStatus(status)
        if status not in _TASK_TRANSITIONS[self.status]:
            raise ValueError(f"TASK_TRANSITION_NOT_ALLOWED:{self.status.value}->{status.value}")
        updated = self.model_dump(mode="python")
        updated.update(
            status=status,
            revision=self.revision + 1,
            updated_at=datetime.now(timezone.utc),
        )
        return type(self).model_validate(updated)


class ConfirmationStatus(str, Enum):
    NOT_REQUIRED = "NOT_REQUIRED"
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class ConfirmationState(_TaskModel):
    status: ConfirmationStatus = ConfirmationStatus.NOT_REQUIRED
    action_id: str | None = None
    requested_at: datetime | None = None
    resolved_at: datetime | None = None
    expires_at: datetime | None = None
    resolved_by: str | None = None


class ExecutionStatus(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    TIMED_OUT = "TIMED_OUT"


_EXECUTION_TRANSITIONS: dict[ExecutionStatus, frozenset[ExecutionStatus]] = {
    ExecutionStatus.NOT_STARTED: frozenset({ExecutionStatus.RUNNING, ExecutionStatus.CANCELLED}),
    ExecutionStatus.RUNNING: frozenset({
        ExecutionStatus.SUCCEEDED,
        ExecutionStatus.FAILED,
        ExecutionStatus.CANCELLED,
        ExecutionStatus.TIMED_OUT,
    }),
    ExecutionStatus.SUCCEEDED: frozenset(),
    ExecutionStatus.FAILED: frozenset(),
    ExecutionStatus.CANCELLED: frozenset(),
    ExecutionStatus.TIMED_OUT: frozenset(),
}


class ExecutionState(_TaskModel):
    execution_id: str | None = None
    status: ExecutionStatus = ExecutionStatus.NOT_STARTED
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error_code: str | None = None
    error_message: str | None = None

    def transition_to(self, status: ExecutionStatus) -> ExecutionState:
        status = ExecutionStatus(status)
        if status not in _EXECUTION_TRANSITIONS[self.status]:
            raise ValueError(f"EXECUTION_TRANSITION_NOT_ALLOWED:{self.status.value}->{status.value}")

        now = datetime.now(timezone.utc)
        updates: dict[str, Any] = {"status": status}
        if status == ExecutionStatus.RUNNING:
            updates["started_at"] = now
        elif status in {
            ExecutionStatus.SUCCEEDED,
            ExecutionStatus.FAILED,
            ExecutionStatus.CANCELLED,
            ExecutionStatus.TIMED_OUT,
        }:
            updates["finished_at"] = now
        updated = self.model_dump(mode="python")
        updated.update(updates)
        return type(self).model_validate(updated)


class PendingActionStatus(str, Enum):
    PENDING = "PENDING"
    EXECUTING = "EXECUTING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"


class PendingAction(_TaskModel):
    """Describes a requested action; this model never executes it."""

    action_id: str = Field(min_length=1)
    action_name: str = Field(min_length=1)
    input: dict[str, Any] = Field(default_factory=dict)
    reason: str
    confirmation_required: bool = False
    status: PendingActionStatus = PendingActionStatus.PENDING
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime | None = None


class TaskError(_TaskModel):
    code: str = Field(min_length=1)
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class TaskState(_TaskModel):
    """Domain-neutral structured state accumulated while completing a task."""

    data: dict[str, Any] = Field(default_factory=dict)
    missing_information: list[str] = Field(default_factory=list)
    pending_action: PendingAction | None = None
    current_step: str | None = None
    revision: int = Field(default=0, ge=0)
    execution: ExecutionState = Field(default_factory=ExecutionState)
    confirmation: ConfirmationState = Field(default_factory=ConfirmationState)
    result: Any = None
    error: TaskError | None = None

    def update_if_revision(
        self,
        expected_revision: int,
        changes: Mapping[str, Any],
    ) -> TaskState:
        if expected_revision != self.revision:
            raise TaskStateRevisionConflict(expected_revision, self.revision)
        if "revision" in changes:
            raise ValueError("TASK_STATE_REVISION_IS_MANAGED")

        updated = self.model_dump(mode="python")
        updated.update(changes)
        updated["revision"] = self.revision + 1
        return type(self).model_validate(updated)


class TaskStateRevisionConflict(ValueError):
    def __init__(self, expected_revision: int, current_revision: int) -> None:
        self.expected_revision = expected_revision
        self.current_revision = current_revision
        super().__init__(
            f"TASK_STATE_REVISION_CONFLICT:expected={expected_revision}:current={current_revision}"
        )
