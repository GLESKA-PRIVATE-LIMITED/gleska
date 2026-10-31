"""Company Brain orchestration: auth context -> plan -> evidence -> validated answer -> persistence."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.ai_gateway import AIBillingError, billing_scope
from app.company_brain import documents, llm
from app.company_brain.answer import Answer, fallback_answer, general_answer, generate_answer
from app.company_brain.pipeline import execute
from app.company_brain.planner import Plan, keyword_plan, make_plan
from app.company_brain.tools import OrgContext
from app.core.supabase import supabase
from app.schemas.auth import UserResponse

logger = logging.getLogger(__name__)

AGENT = "company_brain"
RATE_LIMIT_PER_MINUTE = 10
RATE_LIMIT_PER_DAY = 300
HISTORY_TURNS = 6
MAX_QUESTION_CHARS = 2000


class BrainError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        self.code, self.status_code = code, status_code
        super().__init__(code)


def _rows(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None) or []
    return data if isinstance(data, list) else [data]


def org_context(user: UserResponse) -> OrgContext:
    """Organisation comes only from the authenticated user, never from the request or the model."""
    employer = _rows(supabase.table("employer_profiles").select("id").eq("user_id", str(user.id)).limit(1).execute())
    if not employer:
        raise BrainError("EMPLOYER_PROFILE_REQUIRED", 403)
    account = _rows(supabase.table("billing_accounts").select("id").eq("employer_id", employer[0]["id"]).limit(1).execute())
    return OrgContext(employer_id=str(employer[0]["id"]), user_id=str(user.id),
                      account_id=str(account[0]["id"]) if account else None)


def _check_rate(ctx: OrgContext) -> None:
    now = datetime.now(timezone.utc)
    recent = _rows(supabase.table("company_brain_messages").select("created_at").eq("user_id", ctx.user_id)
                   .eq("role", "user").gte("created_at", (now - timedelta(days=1)).isoformat())
                   .order("created_at", desc=True).limit(RATE_LIMIT_PER_DAY).execute())
    minute_ago = (now - timedelta(minutes=1)).isoformat()
    if len(recent) >= RATE_LIMIT_PER_DAY or sum(1 for r in recent if str(r["created_at"]) >= minute_ago) >= RATE_LIMIT_PER_MINUTE:
        raise BrainError("RATE_LIMITED", 429)


def get_conversation(ctx: OrgContext, conversation_id: str) -> dict[str, Any]:
    rows = _rows(supabase.table("company_brain_conversations").select("*").eq("id", conversation_id)
                 .eq("employer_id", ctx.employer_id).eq("user_id", ctx.user_id).limit(1).execute())
    if not rows:
        raise BrainError("CONVERSATION_NOT_FOUND", 404)
    return rows[0]


def list_conversations(ctx: OrgContext, search: str | None = None) -> list[dict[str, Any]]:
    query = supabase.table("company_brain_conversations").select("id, title, created_at, updated_at") \
        .eq("employer_id", ctx.employer_id).eq("user_id", ctx.user_id)
    if search:
        cleaned = search.replace("%", "").replace("_", "").strip()[:100]
        if cleaned:
            query = query.ilike("title", f"%{cleaned}%")
    return _rows(query.order("updated_at", desc=True).limit(200).execute())


def messages(ctx: OrgContext, conversation_id: str) -> list[dict[str, Any]]:
    get_conversation(ctx, conversation_id)
    return _rows(supabase.table("company_brain_messages")
                 .select("id, role, content, status, answer_status, evidence, validation, error_code, created_at")
                 .eq("conversation_id", conversation_id).eq("employer_id", ctx.employer_id)
                 .order("created_at").limit(500).execute())


def rename(ctx: OrgContext, conversation_id: str, title: str) -> dict[str, Any]:
    get_conversation(ctx, conversation_id)
    return _rows(supabase.table("company_brain_conversations").update({"title": title.strip()[:200] or "New chat",
                                                                      "updated_at": datetime.now(timezone.utc).isoformat()})
                 .eq("id", conversation_id).eq("employer_id", ctx.employer_id).execute())[0]


def delete(ctx: OrgContext, conversation_id: str) -> None:
    get_conversation(ctx, conversation_id)
    supabase.table("company_brain_conversations").delete().eq("id", conversation_id).eq("employer_id", ctx.employer_id).execute()


def _history(ctx: OrgContext, conversation_id: str) -> list[dict[str, Any]]:
    """Previous questions and previous *plans* only; earlier answers are never treated as facts."""
    rows = _rows(supabase.table("company_brain_messages").select("role, content, plan, created_at")
                 .eq("conversation_id", conversation_id).eq("employer_id", ctx.employer_id)
                 .order("created_at", desc=True).limit(HISTORY_TURNS * 2).execute())
    turns: list[dict[str, Any]] = []
    for row in reversed(rows):
        if row["role"] == "user":
            turns.append({"question": row["content"][:500]})
        elif turns and row.get("plan"):
            plan = row["plan"] or {}
            turns[-1]["previous_plan"] = {"tool_calls": plan.get("tool_calls"), "overview": plan.get("overview"),
                                          "overview_period": plan.get("overview_period")}
    return turns


def _sources(package_dict: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for item in package_dict.get("items", []):
        if item.get("source_type") == "unavailable":
            continue
        out.append({k: item.get(k) for k in ("id", "label", "value", "period", "source_agent", "source_table",
                                              "source_type", "record_count", "freshness", "retrieved_at",
                                              "source_updated_at", "calculation_id")}
                   | {"document_id": (item.get("detail") or {}).get("document_id")})
    return out


def _audit(ctx: OrgContext, conversation_id: str, message_id: str | None, audits: list) -> None:
    if not audits:
        return
    try:
        supabase.table("company_brain_query_audit").insert([{
            "employer_id": ctx.employer_id, "user_id": ctx.user_id, "conversation_id": conversation_id,
            "message_id": message_id, "tool": a.tool, "args": a.args, "status": a.status, "row_count": a.row_count,
            "duration_ms": a.duration_ms, "error_code": a.error_code,
        } for a in audits]).execute()
    except Exception:
        logger.exception("company_brain audit write failed")


async def _run(ctx: OrgContext, question: str, history: list[dict[str, Any]], plan: Plan | None = None):
    """Returns (plan, execution or None, Answer). Model outages degrade to deterministic paths."""
    if plan is None:
        try:
            plan = await make_plan(question, history, ctx.as_of.isoformat())
        except llm.BrainModelError:
            plan = keyword_plan(question)
    if plan.needs_clarification:
        return plan, None, Answer(plan.clarification_question or "Could you clarify your question?", "clarification")
    if plan.general_knowledge and not plan.tool_calls:
        try:
            return plan, None, await general_answer(question)
        except llm.BrainModelError:
            return plan, None, Answer("I can't answer general questions right now. Please try again later.", "general")
    execution = await execute(plan, ctx, documents.search)
    try:
        answer = await generate_answer(question, execution.package, history)
    except llm.BrainModelError:
        answer = Answer(fallback_answer(execution.package), "fallback", {"ok": False, "issues": ["model unavailable"]})
    return plan, execution, answer


async def ask(user: UserResponse, question: str, conversation_id: str | None = None,
              plan_override: Plan | None = None) -> dict[str, Any]:
    question = (question or "").strip()
    if not question:
        raise BrainError("QUESTION_REQUIRED")
    if len(question) > MAX_QUESTION_CHARS:
        raise BrainError("QUESTION_TOO_LONG")
    ctx = org_context(user)
    _check_rate(ctx)
    if conversation_id:
        conversation = get_conversation(ctx, conversation_id)
    else:
        conversation = _rows(supabase.table("company_brain_conversations").insert({
            "employer_id": ctx.employer_id, "user_id": ctx.user_id, "title": question[:80]}).execute())[0]
    cid = str(conversation["id"])
    history = _history(ctx, cid)
    supabase.table("company_brain_messages").insert({"conversation_id": cid, "employer_id": ctx.employer_id,
                                                     "user_id": ctx.user_id, "role": "user", "content": question}).execute()
    try:
        with billing_scope(agent=AGENT, user_id=ctx.user_id, conversation_id=cid):
            plan, execution, answer = await _run(ctx, question, history, plan_override)
    except AIBillingError as exc:
        supabase.table("company_brain_messages").insert({
            "conversation_id": cid, "employer_id": ctx.employer_id, "user_id": ctx.user_id, "role": "assistant",
            "content": "This request could not be run.", "status": "failed", "error_code": exc.code}).execute()
        raise
    package = execution.package.as_dict() if execution else {"items": [], "calculations": [], "limitations": [], "conflicts": []}
    saved = _rows(supabase.table("company_brain_messages").insert({
        "conversation_id": cid, "employer_id": ctx.employer_id, "user_id": ctx.user_id, "role": "assistant",
        "content": answer.text[:40000], "answer_status": answer.status,
        "plan": plan.model_dump(), "evidence": package, "validation": answer.validation,
    }).execute())
    message_id = str(saved[0]["id"]) if saved else None
    _audit(ctx, cid, message_id, execution.audits if execution else [])
    supabase.table("company_brain_conversations").update({"updated_at": datetime.now(timezone.utc).isoformat()}) \
        .eq("id", cid).execute()
    return {
        "conversation_id": cid, "message_id": message_id, "answer": answer.text, "answer_status": answer.status,
        "sources": _sources(package), "limitations": package.get("limitations", []),
        "conflicts": package.get("conflicts", []), "calculations": package.get("calculations", []),
        "plan": {"tools": [c.tool for c in plan.tool_calls], "overview": plan.overview, "planner": plan.source},
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


async def summary(user: UserResponse, period: dict[str, Any], conversation_id: str | None = None) -> dict[str, Any]:
    """Executive summary for a period: runs the overview tool set directly (no planner call)."""
    label = period.get("name", "this_month").replace("_", " ")
    plan = Plan(intent="executive summary", overview=True, overview_period=period, source="summary")
    question = (f"Give me an executive summary of my company for {label}: verified facts, calculated metrics, "
                "changes versus the previous period, risks needing attention and evidence-based recommendations.")
    return await ask(user, question, conversation_id, plan_override=plan)


def status(ctx: OrgContext) -> dict[str, Any]:
    docs = _rows(supabase.table("company_brain_documents").select("status, embedding_status, indexed_at")
                 .eq("employer_id", ctx.employer_id).limit(5000).execute())
    by_status: dict[str, int] = {}
    for d in docs:
        by_status[d["status"]] = by_status.get(d["status"], 0) + 1
    return {
        "documents": by_status,
        "documents_without_embeddings": sum(1 for d in docs if d["status"] == "indexed" and d["embedding_status"] != "embedded"),
        "last_indexed_at": max((str(d["indexed_at"]) for d in docs if d.get("indexed_at")), default=None),
        "sources": [
            {"agent": "Hiring", "status": "connected", "freshness": "live"},
            {"agent": "Attendance", "status": "connected", "freshness": "live"},
            {"agent": "Financial", "status": "connected", "freshness": "live"},
            {"agent": "Procurement", "status": "connected", "freshness": "live"},
            {"agent": "Payments & AI credits", "status": "connected", "freshness": "live"},
            {"agent": "Logistics", "status": "connected", "freshness": "live"},
            {"agent": "Documents", "status": "connected", "freshness": "indexed"},
            {"agent": "Tender Filing / Tracking", "status": "no_data", "freshness": None},
            {"agent": "Industrial Maintenance", "status": "no_data", "freshness": None},
        ],
    }
