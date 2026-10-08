from __future__ import annotations

import base64
import binascii
from datetime import datetime, timezone
import hashlib
import hmac
import json
import logging
from typing import Annotated, Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.agents.hiring.tools import DISCOVER_CANDIDATES_TOOL
from app.agents.shared.contracts import AgentExecutionContext
from app.agents.shared.engine import AgentRuntime
from app.agents.shared.registry import default_agent_registry
from app.agents.shared.runtime import (
    AgentConversationMessage,
    AgentLLMRequest,
    AgentRuntimeRequest,
    StructuredAgentResponse,
)
from app.agents.shared.task import AgentTask, TaskState
from app.core.config import settings
from app.core.supabase import supabase
from app.llm.providers import GeminiLLMProvider, LLMProviderError
from app.schemas.auth import UserResponse
from app.schemas.job import JobCreate
from app.schemas.hiring_agent import (
    HiringAgentCandidate,
    HiringAgentConversationResponse,
    HiringAgentCreateRequest,
    HiringAgentHistoryMessage,
    HiringAgentJobDraft,
    HiringAgentMessageRequest,
    HiringAgentResponse,
)
from app.services.job_match_service import JobMatchService
from app.services.job_service import JobNotFound, JobService
from app.tools.shared.executor import ToolExecutor
from app.tools.shared.registry import ToolRegistry

AGENT_KIND = "hiring_agent"
HISTORY_LIMIT = 40
CANDIDATE_CONTEXT_LIMIT = 25
DISTANCE_FRESHNESS_NOTE = (
    "Distance comes from the existing employer match projection. That projection does not "
    "expose whether the coordinate is a fresh live location."
)
logger = logging.getLogger(__name__)


class _HiringConversationContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(default="", max_length=1200)
    stated_needs: list[Annotated[str, Field(max_length=300)]] = Field(default_factory=list, max_length=12)
    deferred_topics: list[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=8)
    job_draft: HiringAgentJobDraft = Field(default_factory=HiringAgentJobDraft)

    @field_validator("stated_needs", "deferred_topics")
    @classmethod
    def normalize_context_items(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(value.strip() for value in values if value.strip()))


class HiringAgentConversationError(ValueError):
    pass


class _GroundedHiringProvider:
    """Prevent model-proposed task state from becoming authoritative runtime state."""

    provider_name = "gemini"

    def __init__(self) -> None:
        self._provider = GeminiLLMProvider()

    async def generate(self, prompt: str, **kwargs: Any) -> Any:
        return await self._provider.generate(prompt, **kwargs)

    async def generate_agent_response(
        self,
        request: AgentLLMRequest,
    ) -> StructuredAgentResponse:
        response = await self._provider.generate_agent_response(request)
        current_state = request.task_state
        proposed_state = response.task_state
        if current_state is None or proposed_state is None:
            return response.model_copy(update={
                "task_state": current_state,
                "completed": False,
            })

        current_context = current_state.data.get("conversation_context", {})
        proposed_context = proposed_state.data.get("conversation_context", current_context)
        try:
            context = _HiringConversationContext.model_validate(proposed_context)
        except ValidationError as exc:
            raise LLMProviderError("LLM_INVALID_RESPONSE") from exc

        # Only bounded conversation notes and validated draft fields cross into durable state.
        state_data = {
            **current_state.data,
            "conversation_context": context.model_dump(mode="json"),
        }
        safe_state = current_state.update_if_revision(
            current_state.revision,
            {"data": state_data},
        )
        return response.model_copy(update={
            "task_state": safe_state,
            "completed": False,
        })


def _job_context(job: Any) -> dict[str, Any]:
    return {
        "title": job.title,
        "status": job.status,
        "headcount_required": job.headcount_required,
        "trade": job.trade_id,
        "required_skills": job.required_skills or [],
        "minimum_experience_years": float(job.min_experience) if job.min_experience is not None else None,
        "maximum_daily_wage": float(job.max_daily_salary) if job.max_daily_salary is not None else None,
        "work_duration_days": job.work_duration_days,
        "work_timing": job.work_timing,
    }


def _candidate_evidence(job: Any, match: Any) -> tuple[list[str], list[str]]:
    evidence = ["Included in the existing current employer match projection for this job."]
    unavailable: list[str] = []

    if job.trade_id:
        if match.trade_id:
            evidence.append(f"Trade is {match.trade_id}; the job requires {job.trade_id}.")
        else:
            unavailable.append("trade")
    else:
        unavailable.append("job trade requirement")

    required_skills = [str(skill).strip() for skill in (job.required_skills or []) if str(skill).strip()]
    candidate_skills = {skill.strip().casefold() for skill in (match.skills or []) if skill.strip()}
    if required_skills:
        matched_skills = [skill for skill in required_skills if skill.casefold() in candidate_skills]
        evidence.append(
            "Required skills present in the returned profile: "
            + (", ".join(matched_skills) if matched_skills else "none could be confirmed from returned skills.")
        )
    else:
        unavailable.append("job required skills")

    if job.min_experience is not None and match.experience_years is not None:
        evidence.append(
            f"Profile reports {match.experience_years} years; job minimum is {float(job.min_experience):g} years."
        )
    elif job.min_experience is not None:
        unavailable.append("experience")
    else:
        unavailable.append("job minimum experience")

    if job.max_daily_salary is not None and match.expected_daily_wage is not None:
        evidence.append(
            f"Profile wage expectation is ₹{float(match.expected_daily_wage):g}/day; "
            f"job maximum is ₹{float(job.max_daily_salary):g}/day."
        )
    elif job.max_daily_salary is not None:
        unavailable.append("expected daily wage")
    else:
        unavailable.append("job maximum daily wage")

    if match.distance_m is not None:
        evidence.append(
            f"Existing projection reports {match.distance_m:.0f} m from the job site; "
            "live-location freshness is not exposed."
        )
    else:
        unavailable.append("distance")

    if match.availability_status is None:
        unavailable.append("availability status")
    else:
        evidence.append(f"Profile availability status returned as {match.availability_status}.")

    return evidence, unavailable


def _to_candidate(match: Any, index: int, job: Any) -> HiringAgentCandidate:
    evidence, unavailable = _candidate_evidence(job, match)
    return HiringAgentCandidate(
        candidate_ref=f"Candidate {index}",
        name=match.name,
        trade=match.trade_id,
        skills=match.skills or [],
        experience_years=match.experience_years,
        expected_daily_wage=(
            float(match.expected_daily_wage) if match.expected_daily_wage is not None else None
        ),
        availability_status=match.availability_status,
        projected_distance_m=match.distance_m,
        verified_evidence=evidence,
        unavailable_fields=unavailable,
    )


def _candidate_for_model(candidate: HiringAgentCandidate) -> dict[str, Any]:
    return candidate.model_dump(
        mode="json",
        exclude={"name"},
    )


class HiringAgentService:
    """Durable employer conversation orchestration for read-only candidate discovery."""

    @staticmethod
    def _row(response: Any) -> dict[str, Any]:
        data = getattr(response, "data", None)
        if isinstance(data, list):
            return data[0] if data else {}
        return data or {}

    @staticmethod
    def _history_from_row(value: Any) -> list[AgentConversationMessage]:
        if not isinstance(value, list):
            raise HiringAgentConversationError("CONVERSATION_HISTORY_INVALID")
        try:
            return [AgentConversationMessage.model_validate(item) for item in value[-HISTORY_LIMIT:]]
        except ValidationError as exc:
            raise HiringAgentConversationError("CONVERSATION_HISTORY_INVALID") from exc

    @staticmethod
    def _owned_site(
        employer_id: str,
        site_id: str | None,
    ) -> tuple[str | None, str | None]:
        if site_id is None:
            return None, None
        response = (
            supabase.table("job_sites")
            .select("id,name")
            .eq("id", site_id)
            .eq("employer_id", employer_id)
            .execute()
        )
        site = HiringAgentService._row(response)
        if not site:
            raise JobNotFound("JOB_SITE_NOT_FOUND")
        return str(site["id"]), str(site.get("name") or "Work site")

    @staticmethod
    def _job_draft(task_state: TaskState) -> HiringAgentJobDraft:
        context = _HiringConversationContext.model_validate(
            task_state.data.get("conversation_context", {})
        )
        return context.job_draft

    @staticmethod
    def _job_create_request(site_id: str | None, draft: HiringAgentJobDraft) -> JobCreate:
        if (
            site_id is None
            or not draft.title
            or draft.headcount_required is None
            or draft.max_daily_salary is None
            or draft.min_experience is None
            or draft.work_duration_days is None
            or not draft.work_timing
        ):
            raise HiringAgentConversationError("JOB_DRAFT_INCOMPLETE")
        return JobCreate(
            job_site_id=site_id,
            title=draft.title,
            headcount_required=draft.headcount_required,
            max_daily_salary=draft.max_daily_salary,
            min_experience=draft.min_experience,
            work_duration_days=draft.work_duration_days,
            work_timing=draft.work_timing,
            trade_id=draft.trade_id,
            required_skills=draft.required_skills,
        )

    @staticmethod
    def _confirmation_token(
        user: UserResponse,
        conversation_id: str,
        revision: int,
    ) -> str:
        payload = json.dumps({
            "user_id": str(user.id),
            "conversation_id": conversation_id,
            "revision": revision,
            "expires_at": int(datetime.now(timezone.utc).timestamp()) + 600,
        }, sort_keys=True, separators=(",", ":")).encode()
        signature = hmac.new(
            settings.JWT_SECRET_KEY.encode(),
            payload,
            hashlib.sha256,
        ).digest()
        return (
            base64.urlsafe_b64encode(payload).decode().rstrip("=")
            + "."
            + base64.urlsafe_b64encode(signature).decode().rstrip("=")
        )

    @staticmethod
    def _verify_confirmation_token(
        user: UserResponse,
        request: HiringAgentCreateRequest,
    ) -> bool:
        try:
            encoded_payload, encoded_signature = request.confirmation_token.split(".", 1)
            payload = base64.urlsafe_b64decode(
                encoded_payload + "=" * (-len(encoded_payload) % 4)
            )
            signature = base64.urlsafe_b64decode(
                encoded_signature + "=" * (-len(encoded_signature) % 4)
            )
            expected = hmac.new(
                settings.JWT_SECRET_KEY.encode(),
                payload,
                hashlib.sha256,
            ).digest()
            if not hmac.compare_digest(signature, expected):
                return False
            claims = json.loads(payload)
            return (
                claims.get("user_id") == str(user.id)
                and claims.get("conversation_id") == str(request.conversation_id)
                and claims.get("revision") == request.state_revision
                and int(claims.get("expires_at", 0))
                > int(datetime.now(timezone.utc).timestamp())
            )
        except (ValueError, TypeError, KeyError, json.JSONDecodeError, UnicodeDecodeError, binascii.Error):
            return False

    @staticmethod
    def _public_history(history: list[AgentConversationMessage]) -> list[HiringAgentHistoryMessage]:
        return [
            HiringAgentHistoryMessage(
                role=item.role,
                content=item.content,
            )
            for item in history
            if item.role in {"user", "assistant"} and item.content
        ]

    @classmethod
    def _load_or_create(
        cls,
        user: UserResponse,
        employer_id: str,
        request: HiringAgentMessageRequest,
        job_id: str | None,
        job: Any | None,
        site_id: str | None,
        site_name: str | None,
    ) -> tuple[str, int, list[AgentConversationMessage], AgentTask, TaskState, dict[str, Any]]:
        if request.conversation_id:
            response = (
                supabase.table("assistant_conversations")
                .select("id,user_id,employer_id,structured_state,history,status,revision")
                .eq("id", str(request.conversation_id))
                .eq("user_id", user.id)
                .eq("employer_id", employer_id)
                .execute()
            )
            conversation = cls._row(response)
            if not conversation:
                raise HiringAgentConversationError("CONVERSATION_NOT_FOUND")
            if conversation.get("status") != "ACTIVE":
                raise HiringAgentConversationError("CONVERSATION_NOT_ACTIVE")
            state = conversation.get("structured_state") or {}
            if state.get("agent_kind") != AGENT_KIND:
                raise HiringAgentConversationError("CONVERSATION_MODE_MISMATCH")
            stored_job_id = str(state["job_id"]) if state.get("job_id") else None
            if stored_job_id and stored_job_id != job_id:
                raise HiringAgentConversationError("CONVERSATION_JOB_MISMATCH")
            if request.state_revision is None or int(conversation.get("revision") or 0) != request.state_revision:
                raise HiringAgentConversationError("STALE_ASSISTANT_STATE")
            try:
                task = AgentTask.model_validate(state["task"])
                task_state = TaskState.model_validate(state["task_state"])
                conversation_context = _HiringConversationContext.model_validate(
                    task_state.data.get("conversation_context", {})
                )
            except (KeyError, ValidationError) as exc:
                raise HiringAgentConversationError("CONVERSATION_STATE_INVALID") from exc
            task_state = task_state.model_copy(update={
                "data": {
                    **task_state.data,
                    "job_id": job_id,
                    "job": _job_context(job) if job else None,
                    "create_job_site_id": site_id,
                    "create_job_site_name": site_name,
                    "conversation_context": conversation_context.model_dump(mode="json"),
                },
            })
            state = {
                **state,
                "job_id": job_id,
                "create_job_site_id": site_id,
                "create_job_site_name": site_name,
            }
            return (
                str(conversation["id"]),
                int(conversation.get("revision") or 0),
                cls._history_from_row(conversation.get("history") or []),
                task,
                task_state,
                state,
            )

        if request.state_revision is not None:
            raise HiringAgentConversationError("CONVERSATION_NOT_FOUND")
        conversation_id = str(uuid4())
        task = AgentTask(task_id=str(uuid4()), task_type="hiring_conversation")
        task_state = TaskState(
            data={
                "job_id": job_id,
                "job": _job_context(job) if job else None,
                "create_job_site_id": site_id,
                "create_job_site_name": site_name,
                "conversation_context": _HiringConversationContext().model_dump(mode="json"),
            },
            current_step="understand_employer_request",
        )
        state = {
            "agent_kind": AGENT_KIND,
            "job_id": job_id,
            "create_job_site_id": site_id,
            "create_job_site_name": site_name,
            "task": task.model_dump(mode="json"),
            "task_state": task_state.model_dump(mode="json"),
            "candidate_cards": [],
            "candidate_result_status": "NOT_RETRIEVED",
            "candidate_result_note": None,
        }
        inserted = supabase.table("assistant_conversations").insert({
            "id": conversation_id,
            "user_id": user.id,
            "employer_id": employer_id,
            "structured_state": state,
            "history": [],
            "language": "EN",
            "status": "ACTIVE",
            "revision": 0,
        }).execute()
        if not cls._row(inserted):
            raise HiringAgentConversationError("CONVERSATION_CREATE_FAILED")
        return conversation_id, 0, [], task, task_state, state

    @staticmethod
    def _build_tooling(
        user: UserResponse,
        job_id: str | None,
        job: Any | None,
    ) -> tuple[ToolRegistry, ToolExecutor, dict[str, Any]]:
        registry = ToolRegistry()
        executor = ToolExecutor(registry)
        tool_capture: dict[str, Any] = {"cards": None, "result_status": None, "result_note": None}

        if job_id is None or job is None:
            return registry, executor, tool_capture

        registry.register(DISCOVER_CANDIDATES_TOOL)

        async def discover_candidates(
            _arguments: dict[str, Any],
            context: AgentExecutionContext,
        ) -> dict[str, Any]:
            if (
                context.user_id != str(user.id)
                or context.role != "EMPLOYER"
                or context.metadata.get("job_id") != job_id
            ):
                raise PermissionError("HIRING_TOOL_CONTEXT_INVALID")

            matches = JobMatchService.list_for_user(user, job_id)
            pending_matches = matches.matches[:CANDIDATE_CONTEXT_LIMIT]
            cards = [
                _to_candidate(match, index + 1, job)
                for index, match in enumerate(pending_matches)
            ]
            tool_capture["cards"] = cards
            tool_capture["result_status"] = "FOUND" if matches.matches else "NO_MATCHES"
            tool_capture["result_note"] = (
                f"Showing {len(pending_matches)} of {len(matches.matches)} current eligible pending matches."
                if len(matches.matches) > len(pending_matches)
                else None
            )
            return {
                "status": "FOUND" if matches.matches else "NO_MATCHES",
                "total_candidate_count": len(matches.matches),
                "returned_candidate_count": len(pending_matches),
                "truncated": len(matches.matches) > len(pending_matches),
                "distance_freshness": DISTANCE_FRESHNESS_NOTE,
                "candidates": [_candidate_for_model(candidate) for candidate in cards],
            }

        executor.register_handler(DISCOVER_CANDIDATES_TOOL.name, discover_candidates)
        return registry, executor, tool_capture

    @classmethod
    def _persist(
        cls,
        user: UserResponse,
        employer_id: str,
        conversation_id: str,
        revision: int,
        state: dict[str, Any],
        history: list[AgentConversationMessage],
    ) -> int:
        next_revision = revision + 1
        updated_state = {
            **state,
            "task": state["task"],
            "task_state": state["task_state"],
        }
        response = (
            supabase.table("assistant_conversations")
            .update({
                "structured_state": updated_state,
                "history": [item.model_dump(mode="json") for item in history[-HISTORY_LIMIT:]],
                "revision": next_revision,
            })
            .eq("id", conversation_id)
            .eq("user_id", user.id)
            .eq("employer_id", employer_id)
            .eq("revision", revision)
            .execute()
        )
        if not getattr(response, "data", None):
            raise HiringAgentConversationError("STALE_ASSISTANT_STATE")
        return next_revision

    @classmethod
    async def process_message(
        cls,
        user: UserResponse,
        request: HiringAgentMessageRequest,
    ) -> HiringAgentResponse:
        if request.conversation_id is None and request.state_revision is not None:
            raise HiringAgentConversationError("CONVERSATION_NOT_FOUND")

        employer = JobService._employer_profile(user)
        employer_id = str(employer["id"])
        job_id = str(request.job_id) if request.job_id else None
        existing_state: dict[str, Any] | None = None

        if request.conversation_id:
            response = (
                supabase.table("assistant_conversations")
                .select("structured_state")
                .eq("id", str(request.conversation_id))
                .eq("user_id", user.id)
                .eq("employer_id", employer_id)
                .execute()
            )
            existing = cls._row(response)
            if not existing:
                raise HiringAgentConversationError("CONVERSATION_NOT_FOUND")
            existing_state = existing.get("structured_state") or {}
            if existing_state.get("agent_kind") != AGENT_KIND:
                raise HiringAgentConversationError("CONVERSATION_MODE_MISMATCH")
            if existing_state.get("job_creation_status") == "CREATING":
                raise HiringAgentConversationError("JOB_CREATION_IN_PROGRESS")
            stored_job_id = str(existing_state.get("job_id") or "")
            if job_id is not None and stored_job_id and job_id != stored_job_id:
                raise HiringAgentConversationError("CONVERSATION_JOB_MISMATCH")
            job_id = job_id or (stored_job_id or None)

        selected_site_id = (
            str(request.selected_job_site_id)
            if request.selected_job_site_id
            else str((existing_state or {}).get("create_job_site_id") or "") or None
        )
        site_id, site_name = cls._owned_site(employer_id, selected_site_id)

        job = None
        if job_id is not None:
            try:
                job = JobService.get_for_user(user, job_id)
            except JobNotFound:
                raise
            if job.status != "SEARCHING":
                raise HiringAgentConversationError("JOB_NOT_SEARCHING")

        conversation_id, revision, history, task, task_state, state = cls._load_or_create(
            user,
            employer_id,
            request,
            job_id,
            job,
            site_id,
            site_name,
        )
        registry, executor, tool_capture = cls._build_tooling(user, job_id, job)
        context = AgentExecutionContext(
            agent_id="hiring",
            user_id=str(user.id),
            role=user.role,
            session_id=conversation_id,
            conversation_id=conversation_id,
            task_id=task.task_id,
            request_id=str(uuid4()),
            permissions=("job:create", "job:read", "assistant:message"),
            metadata={"job_id": job_id, "job_site_id": site_id},
        )
        runtime = AgentRuntime(
            agent_registry=default_agent_registry,
            tool_registry=registry,
            tool_executor=executor,
            llm_provider=_GroundedHiringProvider(),
            max_iterations=4,
        )
        result = await runtime.run(AgentRuntimeRequest(
            context=context,
            message=request.message,
            task=task,
            task_state=task_state,
            history=history,
        ))

        now = datetime.now(timezone.utc).isoformat()
        next_history = [*history, AgentConversationMessage(role="user", content=request.message)]
        tool_results = result.tool_results or []
        for tool_result in tool_results:
            if tool_result.tool_name == DISCOVER_CANDIDATES_TOOL.name:
                next_history.append(AgentConversationMessage(
                    role="tool",
                    content=json.dumps({
                        "success": tool_result.success,
                        "error_code": tool_result.error_code,
                        "data": tool_result.data,
                    }, ensure_ascii=True, default=str),
                    tool_name=tool_result.tool_name,
                    call_id=tool_result.execution_id,
                ))
        assistant_message = result.assistant_message
        tool_failed = any(not tool_result.success for tool_result in tool_results)
        candidate_tool_attempted = any(
            tool_result.tool_name == DISCOVER_CANDIDATES_TOOL.name
            for tool_result in tool_results
        )
        successful_discovery = next(
            (
                tool_result for tool_result in tool_results
                if tool_result.tool_name == DISCOVER_CANDIDATES_TOOL.name and tool_result.success
            ),
            None,
        )
        if result.error:
            assistant_message = (
                "The assistant is temporarily at its usage limit. Your message was saved; "
                "please try again later."
                if result.error.code == "LLM_RATE_LIMITED"
                else "I couldn't complete that request just now. Please try again."
            )
            if candidate_tool_attempted and tool_failed:
                tool_capture["cards"] = []
                tool_capture["result_status"] = "FAILED"
                tool_capture["result_note"] = "Candidate retrieval did not complete."
        elif tool_failed:
            assistant_message = (
                "I couldn't retrieve candidates from the current matching results. "
                "No candidate information is available for this request."
            )
            tool_capture["cards"] = []
            tool_capture["result_status"] = "FAILED"
            tool_capture["result_note"] = "Candidate retrieval did not complete."
        elif successful_discovery:
            data = successful_discovery.data or {}
            if data.get("status") == "NO_MATCHES":
                assistant_message = (
                    "I checked the current eligible matches for this job and no candidates "
                    "are available in the matching results right now."
                )
            elif data.get("truncated"):
                count = data.get("total_candidate_count", 0)
                shown = data.get("returned_candidate_count", 0)
                tool_capture["result_note"] = f"Showing {shown} of {count} current eligible pending matches."

        next_history.append(AgentConversationMessage(role="assistant", content=assistant_message))
        next_history = next_history[-HISTORY_LIMIT:]
        updated_state = {
            **state,
            "task": (result.task or task).model_dump(mode="json"),
            "task_state": (result.task_state or task_state).model_dump(mode="json"),
            "create_job_site_id": site_id,
            "create_job_site_name": site_name,
        }
        if tool_capture["result_status"] is not None:
            updated_state["candidate_cards"] = [
                candidate.model_dump(mode="json")
                for candidate in (tool_capture["cards"] or [])
            ]
            updated_state["candidate_result_status"] = tool_capture["result_status"]
            updated_state["candidate_result_note"] = tool_capture["result_note"]
            updated_state["candidate_retrieved_at"] = now
        next_revision = cls._persist(
            user,
            employer_id,
            conversation_id,
            revision,
            updated_state,
            next_history,
        )
        job_draft = cls._job_draft(result.task_state or task_state)
        create_request = None
        if updated_state.get("job_creation_status") != "CREATED":
            try:
                create_request = cls._job_create_request(site_id, job_draft)
            except (HiringAgentConversationError, ValidationError):
                updated_state.pop("job_creation_status", None)
        confirmation_token = (
            cls._confirmation_token(user, conversation_id, next_revision)
            if create_request is not None
            else None
        )
        return HiringAgentResponse(
            conversation_id=conversation_id,
            job_id=job_id,
            assistant_message=assistant_message,
            state_revision=next_revision,
            history=cls._public_history(next_history),
            candidate_results=[
                HiringAgentCandidate.model_validate(item)
                for item in updated_state.get("candidate_cards", [])
            ],
            candidate_result_status=updated_state.get("candidate_result_status", "NOT_RETRIEVED"),
            candidate_result_note=updated_state.get("candidate_result_note"),
            candidate_retrieved_at=updated_state.get("candidate_retrieved_at"),
            job_draft=job_draft,
            job_site_id=site_id,
            job_site_name=site_name,
            job_confirmation_token=confirmation_token,
            created_job_id=updated_state.get("created_job_id"),
        )

    @classmethod
    def get_conversation(
        cls,
        user: UserResponse,
        conversation_id: UUID,
    ) -> HiringAgentConversationResponse:
        employer = JobService._employer_profile(user)
        response = (
            supabase.table("assistant_conversations")
            .select("structured_state,history,status,revision")
            .eq("id", str(conversation_id))
            .eq("user_id", user.id)
            .eq("employer_id", str(employer["id"]))
            .execute()
        )
        conversation = cls._row(response)
        if not conversation:
            raise HiringAgentConversationError("CONVERSATION_NOT_FOUND")
        state = conversation.get("structured_state") or {}
        if state.get("agent_kind") != AGENT_KIND:
            raise HiringAgentConversationError("CONVERSATION_NOT_FOUND")
        if conversation.get("status") != "ACTIVE":
            raise HiringAgentConversationError("CONVERSATION_NOT_ACTIVE")
        history = cls._history_from_row(conversation.get("history") or [])
        try:
            task_state = TaskState.model_validate(state["task_state"])
            job_draft = cls._job_draft(task_state)
        except (KeyError, ValidationError) as exc:
            raise HiringAgentConversationError("CONVERSATION_STATE_INVALID") from exc
        site_id = str(state["create_job_site_id"]) if state.get("create_job_site_id") else None
        confirmation_token = None
        if state.get("job_creation_status") not in {"CREATING", "CREATED"}:
            try:
                cls._job_create_request(site_id, job_draft)
                confirmation_token = cls._confirmation_token(
                    user,
                    str(conversation_id),
                    int(conversation.get("revision") or 0),
                )
            except (HiringAgentConversationError, ValidationError):
                pass
        return HiringAgentConversationResponse(
            conversation_id=str(conversation_id),
            job_id=str(state["job_id"]) if state.get("job_id") else None,
            state_revision=int(conversation.get("revision") or 0),
            history=cls._public_history(history),
            candidate_results=[
                HiringAgentCandidate.model_validate(item)
                for item in state.get("candidate_cards", [])
            ],
            candidate_result_status=state.get("candidate_result_status", "NOT_RETRIEVED"),
            candidate_result_note=state.get("candidate_result_note"),
            candidate_retrieved_at=state.get("candidate_retrieved_at"),
            job_draft=job_draft,
            job_site_id=site_id,
            job_site_name=state.get("create_job_site_name"),
            job_confirmation_token=confirmation_token,
            created_job_id=state.get("created_job_id"),
        )

    @classmethod
    def create_confirmed_job(
        cls,
        user: UserResponse,
        request: HiringAgentCreateRequest,
    ) -> HiringAgentConversationResponse:
        employer = JobService._employer_profile(user)
        employer_id = str(employer["id"])
        response = (
            supabase.table("assistant_conversations")
            .select("structured_state,history,status,revision")
            .eq("id", str(request.conversation_id))
            .eq("user_id", user.id)
            .eq("employer_id", employer_id)
            .execute()
        )
        conversation = cls._row(response)
        if not conversation:
            raise HiringAgentConversationError("CONVERSATION_NOT_FOUND")
        state = conversation.get("structured_state") or {}
        if state.get("agent_kind") != AGENT_KIND:
            raise HiringAgentConversationError("CONVERSATION_MODE_MISMATCH")
        if conversation.get("status") != "ACTIVE":
            raise HiringAgentConversationError("CONVERSATION_NOT_ACTIVE")
        revision = int(conversation.get("revision") or 0)
        if revision != request.state_revision:
            raise HiringAgentConversationError("STALE_ASSISTANT_STATE")
        if state.get("job_creation_status") in {"CREATING", "CREATED"}:
            raise HiringAgentConversationError("JOB_CREATION_ALREADY_HANDLED")
        if not cls._verify_confirmation_token(user, request):
            raise HiringAgentConversationError("INVALID_CONFIRMATION")
        try:
            task_state = TaskState.model_validate(state["task_state"])
            draft = cls._job_draft(task_state)
            job_request = cls._job_create_request(
                str(state["create_job_site_id"]) if state.get("create_job_site_id") else None,
                draft,
            )
        except (KeyError, ValidationError, HiringAgentConversationError) as exc:
            raise HiringAgentConversationError("JOB_DRAFT_INCOMPLETE") from exc

        claimed_state = {**state, "job_creation_status": "CREATING"}
        claimed_revision = revision + 1
        claim = (
            supabase.table("assistant_conversations")
            .update({
                "structured_state": claimed_state,
                "revision": claimed_revision,
            })
            .eq("id", str(request.conversation_id))
            .eq("user_id", user.id)
            .eq("employer_id", employer_id)
            .eq("revision", revision)
            .execute()
        )
        if not getattr(claim, "data", None):
            raise HiringAgentConversationError("STALE_ASSISTANT_STATE")

        try:
            created_job = JobService.create(user, job_request)
        except Exception:
            reset_state = {**state, "job_creation_status": "PENDING"}
            try:
                reset = (
                    supabase.table("assistant_conversations")
                    .update({
                        "structured_state": reset_state,
                        "revision": claimed_revision + 1,
                    })
                    .eq("id", str(request.conversation_id))
                    .eq("user_id", user.id)
                    .eq("employer_id", employer_id)
                    .eq("revision", claimed_revision)
                    .execute()
                )
                if not getattr(reset, "data", None):
                    logger.error(
                        "Hiring Agent job-creation claim could not be reset after create failure: "
                        "conversation_id=%s user_id=%s revision=%s",
                        request.conversation_id,
                        user.id,
                        claimed_revision,
                    )
            except Exception:
                logger.exception(
                    "Hiring Agent job-creation claim reset failed: "
                    "conversation_id=%s user_id=%s revision=%s",
                    request.conversation_id,
                    user.id,
                    claimed_revision,
                )
            raise

        history = cls._history_from_row(conversation.get("history") or [])
        history.extend([
            AgentConversationMessage(role="user", content="Confirm job creation."),
            AgentConversationMessage(
                role="assistant",
                content=f"Job {created_job.title} was created successfully.",
            ),
        ])
        completed_state = {
            **state,
            "job_creation_status": "CREATED",
            "created_job_id": created_job.id,
        }
        finalized = (
            supabase.table("assistant_conversations")
            .update({
                "structured_state": completed_state,
                "history": [item.model_dump(mode="json") for item in history[-HISTORY_LIMIT:]],
                "revision": claimed_revision + 1,
            })
            .eq("id", str(request.conversation_id))
            .eq("user_id", user.id)
            .eq("employer_id", employer_id)
            .eq("revision", claimed_revision)
            .execute()
        )
        if not getattr(finalized, "data", None):
            logger.error(
                "Hiring Agent job created but conversation finalization failed: "
                "conversation_id=%s user_id=%s job_id=%s revision=%s",
                request.conversation_id,
                user.id,
                created_job.id,
                claimed_revision,
            )
            raise HiringAgentConversationError("JOB_CREATED_CONVERSATION_UPDATE_FAILED")
        return cls.get_conversation(user, request.conversation_id)
