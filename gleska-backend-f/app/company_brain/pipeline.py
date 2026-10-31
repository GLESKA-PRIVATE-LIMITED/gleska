"""Execute a plan: run approved tools, add period comparisons, assemble the evidence package."""

from __future__ import annotations

import logging
import time
from datetime import timedelta
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Awaitable, Callable

from app.company_brain.data_access import DataAccessError
from app.company_brain.evidence import Evidence, EvidencePackage, ToolResult, format_amount
from app.company_brain.periods import PeriodSpec
from app.company_brain.planner import OVERVIEW_TOOLS, Plan, ToolCall
from app.company_brain.tools import TOOLS, OrgContext

logger = logging.getLogger(__name__)

DocumentSearch = Callable[[OrgContext, dict[str, Any]], Awaitable[ToolResult]]


@dataclass
class ToolAudit:
    tool: str
    args: dict[str, Any]
    status: str
    row_count: int
    duration_ms: int
    error_code: str | None = None


@dataclass
class Execution:
    package: EvidencePackage
    audits: list[ToolAudit] = field(default_factory=list)


def _period_args(args: dict[str, Any], period: dict[str, Any] | None) -> dict[str, Any]:
    out = dict(args)
    if period is not None:
        out["period"] = period
    return out


def _change_evidence(tool: str, current: ToolResult, previous: ToolResult, label_now: str, label_before: str) -> list[Evidence]:
    out = []
    for key, (now, unit) in current.scalars.items():
        if key not in previous.scalars:
            continue
        before = previous.scalars[key][0]
        diff = now - before
        if before == 0:
            pct = "not defined (previous value was 0)"
        else:
            pct = f"{(diff / before * 100).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP):+}%"
        fmt = (lambda v: format_amount(v, unit)) if unit not in ("count",) else (lambda v: str(v))
        metric = key.split(":")[0]
        out.append(Evidence(
            label=f"Change in {metric.replace('_', ' ')}{' (' + unit + ')' if unit != 'count' else ''}",
            value=f"{fmt(before)} → {fmt(now)} (difference {fmt(diff)}, {pct})", numeric=diff, unit=unit,
            metric=f"compare.{metric}", period=f"{label_before} vs {label_now}", source_agent="calculation",
            source_table=tool, source_type="calculation", fields=[metric],
            detail={"previous": str(before), "current": str(now), "difference": str(diff), "percent": pct}))
    return out


async def execute(plan: Plan, ctx: OrgContext, document_search: DocumentSearch | None) -> Execution:
    package = EvidencePackage()
    audits: list[ToolAudit] = []
    calls: list[ToolCall] = list(plan.tool_calls)
    if plan.overview:
        period = plan.overview_period or {"name": "this_month"}
        for name in OVERVIEW_TOOLS:
            if not any(c.tool == name for c in calls):
                args = {"period": period} if "period" in TOOLS[name].args.model_fields else {}
                calls.append(ToolCall(tool=name, args=args, compare_with_previous=TOOLS[name].comparable))
        for domain in ("tender", "maintenance"):
            calls.append(ToolCall(tool="unavailable_domain", args={"domain": domain}))

    for call in calls:
        started = time.monotonic()
        try:
            if call.tool == "document_search":
                if document_search is None:
                    result = ToolResult("document_search", limitations=["Document search is not available yet."])
                else:
                    result = await document_search(ctx, call.args)
            else:
                tool = TOOLS[call.tool]
                result = tool.run(ctx, tool.args.model_validate(call.args))
                if call.compare_with_previous and tool.comparable:
                    spec = PeriodSpec.model_validate(call.args.get("period") or {})
                    period = spec.resolve(ctx.as_of)
                    if period.start is not None:
                        prev = period.previous()
                        prev_args = _period_args(call.args, {"name": "custom", "start": prev.start.isoformat(),
                                                             "end_inclusive": (prev.end - timedelta(days=1)).isoformat()})
                        previous = tool.run(ctx, tool.args.model_validate(prev_args))
                        for e in previous.evidence:
                            e.label = f"{e.label} – previous period"
                        result.evidence.extend(previous.evidence)
                        result.calculations.extend(previous.calculations)
                        result.evidence.extend(_change_evidence(call.tool, result, previous, period.label, prev.label))
            package.extend(result)
            audits.append(ToolAudit(call.tool, call.args, "ok", result.row_count, int((time.monotonic() - started) * 1000)))
        except DataAccessError as exc:
            logger.error("company_brain tool blocked: tool=%s code=%s", call.tool, exc)
            package.limitations.append(f"A data lookup ({call.tool}) was blocked by a safety rule and skipped.")
            audits.append(ToolAudit(call.tool, call.args, "blocked", 0, int((time.monotonic() - started) * 1000), str(exc)[:80]))
        except Exception as exc:  # one failing source must not hide the others; it is disclosed instead
            logger.exception("company_brain tool failed: tool=%s", call.tool)
            package.limitations.append(f"Data for {call.tool.replace('_', ' ')} could not be retrieved right now.")
            audits.append(ToolAudit(call.tool, call.args, "error", 0, int((time.monotonic() - started) * 1000),
                                    type(exc).__name__))
    return Execution(package, audits)
