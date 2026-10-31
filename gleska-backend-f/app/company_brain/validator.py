"""Deterministic answer validation: no number, date or citation may appear without evidence."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from app.company_brain.evidence import EvidencePackage

CITATION = re.compile(r"\[E(\d+)\]")
ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
NUMBER = re.compile(r"(?<![\w.])-?\d[\d,]*(?:\.\d+)?")
LIST_MARKER = re.compile(r"^\s*(?:[-*]\s+)?\d{1,2}[.)]\s+", re.MULTILINE)


@dataclass
class ValidationResult:
    ok: bool
    issues: list[str] = field(default_factory=list)
    cited: list[str] = field(default_factory=list)


def _to_dec(token: str) -> Decimal | None:
    try:
        return Decimal(token.replace(",", ""))
    except InvalidOperation:
        return None


def _allowed_numbers(package: EvidencePackage, question: str) -> tuple[set[Decimal], set[str]]:
    texts = [question]
    for item in package.items:
        texts += [item.value, item.label, item.period or "", str(item.record_count or ""), str(item.numeric or "")]
        if item.detail:
            texts += [str(v) for v in item.detail.values()]
    texts += package.limitations + package.conflicts
    numbers: set[Decimal] = set()
    dates: set[str] = set()
    for text in texts:
        for match in ISO_DATE.finditer(text):
            dates.add(match.group(0))
            numbers.update(Decimal(int(g)) for g in match.groups())
        for token in NUMBER.findall(ISO_DATE.sub(" ", text)):
            value = _to_dec(token)
            if value is None:
                continue
            numbers.add(value.copy_abs())
            for places in ("1", "0.1", "0.01"):
                numbers.add(value.copy_abs().quantize(Decimal(places), rounding=ROUND_HALF_UP))
    return numbers, dates


def validate_answer(answer: str, package: EvidencePackage, question: str, *, general_knowledge: bool = False) -> ValidationResult:
    issues: list[str] = []
    known = {item.id for item in package.items}
    cited = sorted({f"E{n}" for n in CITATION.findall(answer)}, key=lambda x: int(x[1:]))
    for ref in cited:
        if ref not in known:
            issues.append(f"citation {ref} does not exist")
    if general_knowledge:
        if cited:
            issues.append("general-knowledge answer must not cite company evidence")
        return ValidationResult(not issues, issues, cited)

    allowed, allowed_dates = _allowed_numbers(package, question)
    body = LIST_MARKER.sub("", CITATION.sub(" ", answer))
    for line in body.splitlines():
        if not line.strip():
            continue
        for match in ISO_DATE.finditer(line):
            if match.group(0) not in allowed_dates:
                issues.append(f"date {match.group(0)} is not in the evidence")
        line_numbers = []
        for token in NUMBER.findall(ISO_DATE.sub(" ", line)):
            value = _to_dec(token)
            if value is None:
                continue
            line_numbers.append(token)
            if value.copy_abs() not in allowed:
                issues.append(f"number {token} is not in the evidence")
    # Every line that states a company number must carry a citation.
    for raw_line in LIST_MARKER.sub("", answer).splitlines():
        stripped = CITATION.sub("", raw_line)
        has_number = bool(NUMBER.search(ISO_DATE.sub(" ", stripped)))
        if has_number and not CITATION.search(raw_line) and not _only_question_numbers(stripped, question):
            issues.append(f"uncited figure in: {raw_line.strip()[:80]}")
    return ValidationResult(not issues, issues, cited)


def _only_question_numbers(line: str, question: str) -> bool:
    q = {_to_dec(t) for t in NUMBER.findall(question)}
    tokens = [_to_dec(t) for t in NUMBER.findall(ISO_DATE.sub(" ", line))]
    return all(t in q for t in tokens if t is not None)
