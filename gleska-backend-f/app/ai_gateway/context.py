"""Who an AI request is billed to and attributed to, carried through async call chains."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace
from typing import Iterator

_current: ContextVar["BillingContext | None"] = ContextVar("ai_billing_context", default=None)


@dataclass(frozen=True)
class BillingContext:
    user_id: str
    initiating_agent: str
    executing_agent: str
    conversation_id: str | None = None
    parent_task_id: str | None = None


def current_billing_context() -> BillingContext | None:
    return _current.get()


@contextmanager
def billing_scope(
    *,
    agent: str,
    user_id: str | None = None,
    conversation_id: str | None = None,
    parent_task_id: str | None = None,
) -> Iterator[BillingContext]:
    """Attribute AI calls in this block to `agent`.

    Nested scopes keep the outer user and initiating agent (multi-agent orchestration), so a
    child agent's calls are billed to the original customer and show both agents.
    """
    outer = _current.get()
    if outer is None:
        if not user_id:
            raise ValueError("billing_scope needs user_id at the outermost level")
        context = BillingContext(user_id, agent, agent, conversation_id, parent_task_id)
    else:
        context = replace(
            outer,
            executing_agent=agent,
            conversation_id=conversation_id or outer.conversation_id,
            parent_task_id=parent_task_id or outer.parent_task_id,
        )
    token = _current.set(context)
    try:
        yield context
    finally:
        _current.reset(token)


def billed_entry(agent: str, user_arg: str = "user"):
    """Decorate an async service entry point so AI calls inside it are attributed to `agent`.

    The user is taken from the `user_arg` parameter: a UserResponse-like object with `.id`, or a
    user id string. Works on plain functions and on classmethods (apply below @classmethod).
    """
    import functools
    import inspect

    def decorate(func):
        signature = inspect.signature(func)

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            bound = signature.bind_partial(*args, **kwargs)
            user = bound.arguments.get(user_arg)
            user_id = getattr(user, "id", user)
            with billing_scope(agent=agent, user_id=str(user_id) if user_id else None):
                return await func(*args, **kwargs)

        return wrapper

    return decorate
