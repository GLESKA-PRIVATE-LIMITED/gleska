"""Evidence and calculation records: the only carriers of company facts into an answer.

Every number Company Brain may state lives in an `Evidence` item produced by a backend tool. The
answer model receives these items and may only restate them; the validator checks that it did.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import uuid4

MAX_RECORD_IDS = 50


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def dec(value: Any) -> Decimal:
    """Exact Decimal from DB values (NUMERIC arrives as str or float JSON; floats go via str)."""
    if value is None or value == "":
        return Decimal(0)
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def format_amount(value: Decimal, currency: str | None = None) -> str:
    """Indian digit grouping for INR, western grouping otherwise. Display only."""
    value = money(value) if currency else value
    sign = "-" if value < 0 else ""
    text = f"{abs(value):f}"
    whole, _, frac = text.partition(".")
    if currency == "INR" and len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    else:
        whole = f"{int(whole):,}"
    shown = f"{whole}.{frac}" if frac else whole
    if currency == "INR":
        return f"{sign}₹{shown}"
    return f"{sign}{shown} {currency}" if currency else f"{sign}{shown}"


@dataclass
class Calculation:
    metric: str
    formula: str
    result: str
    unit: str
    period: str | None
    input_table: str
    input_record_ids: list[str]
    input_count: int
    id: str = field(default_factory=lambda: f"calc_{uuid4().hex[:10]}")
    executed_at: str = field(default_factory=lambda: now_utc().isoformat())

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "metric": self.metric, "formula": self.formula, "result": self.result,
            "unit": self.unit, "period": self.period, "input_table": self.input_table,
            "input_record_ids": self.input_record_ids[:MAX_RECORD_IDS], "input_count": self.input_count,
            "executed_at": self.executed_at,
        }


@dataclass
class Evidence:
    """One verifiable fact. `value` is the canonical text the answer must reuse."""

    label: str
    value: str
    source_agent: str
    source_table: str
    metric: str | None = None
    unit: str | None = None
    numeric: Decimal | None = None
    period: str | None = None
    record_ids: list[str] = field(default_factory=list)
    record_count: int | None = None
    fields: list[str] = field(default_factory=list)
    source_type: str = "table"  # table | document | calculation | unavailable | profile
    source_updated_at: str | None = None
    freshness: str = "live"  # live | indexed
    classification: str = "internal"
    calculation_id: str | None = None
    detail: dict[str, Any] | None = None
    retrieved_at: str = field(default_factory=lambda: now_utc().isoformat())
    id: str = ""  # assigned by EvidencePackage (E1, E2, ...)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "label": self.label, "value": self.value, "metric": self.metric, "unit": self.unit,
            "numeric": str(self.numeric) if self.numeric is not None else None, "period": self.period,
            "source_agent": self.source_agent, "source_type": self.source_type, "source_table": self.source_table,
            "record_ids": self.record_ids[:MAX_RECORD_IDS], "record_count": self.record_count, "fields": self.fields,
            "source_updated_at": self.source_updated_at, "freshness": self.freshness,
            "classification": self.classification, "calculation_id": self.calculation_id,
            "retrieved_at": self.retrieved_at, "detail": self.detail,
        }


@dataclass
class ToolResult:
    tool: str
    evidence: list[Evidence] = field(default_factory=list)
    calculations: list[Calculation] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    # Named scalar metrics for deterministic period comparison: {"key": (Decimal, unit)}
    scalars: dict[str, tuple[Decimal, str]] = field(default_factory=dict)
    row_count: int = 0

    def add(self, evidence: Evidence, calculation: Calculation | None = None) -> Evidence:
        if calculation is not None:
            self.calculations.append(calculation)
            evidence.calculation_id = calculation.id
        self.evidence.append(evidence)
        return evidence


class EvidencePackage:
    """Numbered evidence for one question, with limitations and conflicts."""

    def __init__(self) -> None:
        self.items: list[Evidence] = []
        self.calculations: list[Calculation] = []
        self.limitations: list[str] = []
        self.conflicts: list[str] = []
        self.tools: list[str] = []

    def extend(self, result: ToolResult) -> None:
        self.tools.append(result.tool)
        for item in result.evidence:
            item.id = f"E{len(self.items) + 1}"
            self.items.append(item)
        self.calculations.extend(result.calculations)
        self.limitations.extend(x for x in result.limitations if x not in self.limitations)
        self.conflicts.extend(x for x in result.conflicts if x not in self.conflicts)

    def by_id(self) -> dict[str, Evidence]:
        return {item.id: item for item in self.items}

    def has_facts(self) -> bool:
        return any(item.source_type != "unavailable" for item in self.items)

    def as_dict(self) -> dict[str, Any]:
        return {
            "items": [item.as_dict() for item in self.items],
            "calculations": [c.as_dict() for c in self.calculations],
            "limitations": self.limitations,
            "conflicts": self.conflicts,
            "tools": self.tools,
        }


def iso(value: date | datetime | None) -> str | None:
    return value.isoformat() if value is not None else None
