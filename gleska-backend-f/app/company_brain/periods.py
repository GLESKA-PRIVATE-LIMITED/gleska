"""Reporting periods in India time. A period is the half-open date range [start, end)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, Field, model_validator

IST = timezone(timedelta(hours=5, minutes=30))

PeriodName = Literal[
    "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
    "this_quarter", "last_quarter", "this_year", "last_year", "last_7_days", "last_30_days",
    "last_90_days", "all_time", "custom",
]


def today_ist() -> date:
    return datetime.now(IST).date()


@dataclass(frozen=True)
class Period:
    name: str
    start: date | None  # None = unbounded (all time)
    end: date  # exclusive

    @property
    def label(self) -> str:
        if self.start is None:
            return f"all time up to {(self.end - timedelta(days=1)).isoformat()}"
        last = self.end - timedelta(days=1)
        return self.start.isoformat() if last == self.start else f"{self.start.isoformat()} to {last.isoformat()}"

    def start_ts(self) -> str | None:
        return datetime.combine(self.start, datetime.min.time(), IST).isoformat() if self.start else None

    def end_ts(self) -> str:
        return datetime.combine(self.end, datetime.min.time(), IST).isoformat()

    def previous(self) -> "Period":
        """Same-length period immediately before (calendar-aware for months/quarters/years)."""
        if self.start is None:
            raise ValueError("all-time period has no previous period")
        if _is_month(self):  # whole calendar month(s) -> the previous whole month
            start = (self.start - timedelta(days=1)).replace(day=1)
            return Period(f"before_{self.name}", start, self.start)
        if self.start.day == 1:  # month-to-date -> same days of the previous month (like for like)
            start = (self.start - timedelta(days=1)).replace(day=1)
            return Period(f"before_{self.name}", start, min(start + (self.end - self.start), self.start))
        length = self.end - self.start
        return Period(f"before_{self.name}", self.start - length, self.start)


def _is_month(period: Period) -> bool:
    return period.start is not None and period.start.day == 1 and period.end.day == 1


def _quarter_start(d: date) -> date:
    return date(d.year, 3 * ((d.month - 1) // 3) + 1, 1)


def _add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    return date(d.year + m // 12, m % 12 + 1, 1)


class PeriodSpec(BaseModel):
    """What the planner may ask for. Custom dates are validated; nothing else is accepted."""

    name: PeriodName = "this_month"
    start: date | None = None
    end_inclusive: date | None = Field(default=None, description="last day included")

    @model_validator(mode="after")
    def custom_needs_dates(self) -> "PeriodSpec":
        if self.name == "custom":
            if not self.start or not self.end_inclusive or self.end_inclusive < self.start:
                raise ValueError("custom period needs start <= end_inclusive")
            if (self.end_inclusive - self.start).days > 3660:
                raise ValueError("custom period longer than 10 years")
        return self

    def resolve(self, today: date | None = None) -> Period:
        t = today or today_ist()
        tomorrow = t + timedelta(days=1)
        n = self.name
        if n == "today":
            return Period(n, t, tomorrow)
        if n == "yesterday":
            return Period(n, t - timedelta(days=1), t)
        if n == "this_week":
            return Period(n, t - timedelta(days=t.weekday()), tomorrow)
        if n == "last_week":
            monday = t - timedelta(days=t.weekday())
            return Period(n, monday - timedelta(days=7), monday)
        if n == "this_month":
            return Period(n, t.replace(day=1), tomorrow)
        if n == "last_month":
            first = t.replace(day=1)
            return Period(n, _add_months(first, -1), first)
        if n == "this_quarter":
            return Period(n, _quarter_start(t), tomorrow)
        if n == "last_quarter":
            q = _quarter_start(t)
            return Period(n, _add_months(q, -3), q)
        if n == "this_year":
            return Period(n, date(t.year, 1, 1), tomorrow)
        if n == "last_year":
            return Period(n, date(t.year - 1, 1, 1), date(t.year, 1, 1))
        if n in ("last_7_days", "last_30_days", "last_90_days"):
            days = int(n.split("_")[1])
            return Period(n, tomorrow - timedelta(days=days), tomorrow)
        if n == "all_time":
            return Period(n, None, tomorrow)
        assert self.start and self.end_inclusive
        return Period("custom", self.start, self.end_inclusive + timedelta(days=1))
