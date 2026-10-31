"""Approved Company Brain tools. Each implements metrics from docs/company-brain/COMPANY_DATA_DICTIONARY.md.

Tools take a server-built `OrgContext` (never model-supplied) plus validated arguments, read rows
through `data_access.fetch`, compute with Decimal, and return evidence + calculation records.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field

from app.company_brain.data_access import fetch
from app.company_brain.evidence import Calculation, Evidence, ToolResult, dec, format_amount, money
from app.company_brain.periods import Period, PeriodSpec, today_ist

ACTIVE_MATCH = ("ACCEPTED", "IN_PROGRESS", "ARRIVED")
ENGAGED_MATCH = ACTIVE_MATCH + ("COMPLETED",)
LIVE_JOB = ("SEARCHING", "FILLED")
PO_OPEN = ("ACCEPTED", "PREPARING", "DISPATCHED", "PARTIALLY_DELIVERED")
PO_AWAITING = ("ISSUED",)
PO_CLOSED_BAD = ("CANCELLED", "REJECTED")
PO_STATUSES = PO_OPEN + PO_AWAITING + PO_CLOSED_BAD + ("DELIVERED",)


@dataclass(frozen=True)
class OrgContext:
    employer_id: str
    user_id: str
    account_id: str | None = None
    today: date | None = None

    @property
    def as_of(self) -> date:
        return self.today or today_ist()


def _ids(rows: list[dict[str, Any]], key: str = "id") -> list[str]:
    return [str(r[key]) for r in rows if r.get(key) is not None]


def _latest(rows: list[dict[str, Any]], *keys: str) -> str | None:
    values = [str(r[k]) for r in rows for k in keys if r.get(k)]
    return max(values) if values else None


def _in_period(value: Any, period: Period) -> bool:
    if not value:
        return False
    d = str(value)[:10]
    return (period.start is None or d >= period.start.isoformat()) and d < period.end.isoformat()


def _count_ev(result: ToolResult, label: str, metric: str, n: int, table: str, ids: list[str], period: str | None,
              agent: str, formula: str, updated: str | None, fields: list[str]) -> None:
    calc = Calculation(metric=metric, formula=formula, result=str(n), unit="count", period=period,
                       input_table=table, input_record_ids=ids, input_count=len(ids))
    result.add(Evidence(label=label, value=str(n), numeric=Decimal(n), unit="count", metric=metric, period=period,
                        source_agent=agent, source_table=table, record_ids=ids, record_count=len(ids),
                        fields=fields, source_updated_at=updated), calc)
    result.scalars[metric] = (Decimal(n), "count")


def _money_evs(result: ToolResult, label: str, metric: str, totals: dict[str, Decimal], ids_by_cur: dict[str, list[str]],
               table: str, period: str | None, agent: str, formula: str, updated: str | None, fields: list[str],
               classification: str = "financial") -> None:
    if not totals:
        calc = Calculation(metric=metric, formula=formula, result="0", unit="INR", period=period,
                           input_table=table, input_record_ids=[], input_count=0)
        result.add(Evidence(label=f"{label} (no matching records)", value=format_amount(Decimal(0), "INR"),
                            numeric=Decimal(0), unit="INR", metric=metric, period=period, source_agent=agent,
                            source_table=table, record_count=0, fields=fields, source_updated_at=updated,
                            classification=classification), calc)
        result.scalars[f"{metric}:INR"] = (Decimal(0), "INR")
        return
    for currency in sorted(totals):
        value = money(totals[currency])
        ids = ids_by_cur.get(currency, [])
        calc = Calculation(metric=metric, formula=formula, result=str(value), unit=currency, period=period,
                           input_table=table, input_record_ids=ids, input_count=len(ids))
        result.add(Evidence(label=f"{label} ({currency})", value=format_amount(value, currency), numeric=value,
                            unit=currency, metric=metric, period=period, source_agent=agent, source_table=table,
                            record_ids=ids, record_count=len(ids), fields=fields, source_updated_at=updated,
                            classification=classification), calc)
        result.scalars[f"{metric}:{currency}"] = (value, currency)


def _truncation(result: ToolResult, *rowsets) -> None:
    for rs in rowsets:
        if rs.truncated:
            result.limitations.append(
                f"Only the first {len(rs.rows)} rows of {rs.table} were analysed; totals may be incomplete.")


# ------------------------------------------------------------------ argument models

class NoArgs(BaseModel):
    pass


class PeriodArgs(BaseModel):
    period: PeriodSpec = Field(default_factory=PeriodSpec)


class TopArgs(BaseModel):
    period: PeriodSpec = Field(default_factory=lambda: PeriodSpec(name="all_time"))
    top_n: int = Field(default=5, ge=1, le=20)


class ProcurementSupplierArgs(TopArgs):
    status_group: Literal["open", "awaiting_supplier", "delivered", "all_active"] = "all_active"


class UnavailableArgs(BaseModel):
    domain: Literal["tender", "maintenance", "payroll", "departments", "expenses_other", "payables", "customers_master"]


# ------------------------------------------------------------------ workforce

def _org_jobs(ctx: OrgContext):
    return fetch("jobs", ["id", "title", "status", "headcount_required", "max_daily_salary", "updated_at"],
                 employer_id=ctx.employer_id)


def workforce_summary(ctx: OrgContext, _: NoArgs) -> ToolResult:
    r = ToolResult("workforce_summary")
    jobs = _org_jobs(ctx)
    job_by_id = {str(j["id"]): j for j in jobs.rows}
    matches = fetch("job_matches", ["id", "job_id", "worker_profile_id", "status", "created_at"],
                    employer_id=None, filters=[("in", "job_id", list(job_by_id))])
    _truncation(r, jobs, matches)
    updated = _latest(jobs.rows, "updated_at")
    agent = "hiring"

    active, engaged, pending = {}, {}, []
    for m in matches.rows:
        job = job_by_id.get(str(m["job_id"]))
        worker = str(m.get("worker_profile_id") or "")
        if m.get("status") in ENGAGED_MATCH and worker:
            engaged.setdefault(worker, m["id"])
        if m.get("status") in ACTIVE_MATCH and job and job.get("status") in LIVE_JOB and worker:
            active.setdefault(worker, m)
        if m.get("status") == "PENDING":
            pending.append(str(m["id"]))
    _count_ev(r, "Active workers (currently assigned)", "workforce.active_workers", len(active), "job_matches",
              [str(m["id"]) for m in active.values()], "as of today", agent,
              "count distinct worker where match.status in (ACCEPTED, IN_PROGRESS, ARRIVED) and job.status in (SEARCHING, FILLED)",
              updated, ["job_matches.status", "jobs.status"])
    _count_ev(r, "Workers ever engaged", "workforce.engaged_workers", len(engaged), "job_matches",
              [str(v) for v in engaged.values()], "all time", agent,
              "count distinct worker where match.status in (ACCEPTED, IN_PROGRESS, ARRIVED, COMPLETED)",
              updated, ["job_matches.status"])
    _count_ev(r, "Candidates awaiting your decision", "workforce.pending_candidates", len(pending), "job_matches",
              pending, "as of today", agent, "count match where status = PENDING", updated, ["job_matches.status"])

    open_jobs = [j for j in jobs.rows if j.get("status") == "SEARCHING"]
    _count_ev(r, "Open jobs (recruiting)", "workforce.open_jobs", len(open_jobs), "jobs", _ids(open_jobs),
              "as of today", agent, "count job where status = SEARCHING", updated, ["jobs.status"])
    by_status: dict[str, int] = defaultdict(int)
    for j in jobs.rows:
        by_status[str(j.get("status"))] += 1
    r.add(Evidence(label="Jobs by status", value=", ".join(f"{k}: {v}" for k, v in sorted(by_status.items())) or "no jobs",
                   source_agent=agent, source_table="jobs", record_ids=_ids(jobs.rows), record_count=len(jobs.rows),
                   fields=["jobs.status"], source_updated_at=updated, period="as of today", metric="workforce.jobs_by_status",
                   detail=dict(by_status)))

    active_per_job: dict[str, int] = defaultdict(int)
    for m in active.values():
        active_per_job[str(m["job_id"])] += 1
    gap = sum(max(int(j.get("headcount_required") or 0) - active_per_job.get(str(j["id"]), 0), 0) for j in open_jobs)
    _count_ev(r, "Unfilled positions on open jobs", "workforce.headcount_gap", gap, "jobs", _ids(open_jobs),
              "as of today", agent, "sum(max(headcount_required - active workers on job, 0)) over SEARCHING jobs",
              updated, ["jobs.headcount_required"])

    cap = Decimal(0)
    cap_ids, missing = [], 0
    for m in active.values():
        job = job_by_id.get(str(m["job_id"])) or {}
        if job.get("max_daily_salary") is None:
            missing += 1
            continue
        cap += dec(job["max_daily_salary"])
        cap_ids.append(str(m["id"]))
    _money_evs(r, "Daily wage commitment – upper bound from offered maximum daily wage", "workforce.daily_wage_cap_commitment",
               {"INR": cap} if active else {}, {"INR": cap_ids}, "jobs", "per day, as of today", agent,
               "sum(jobs.max_daily_salary) over active worker assignments", updated, ["jobs.max_daily_salary"],
               classification="workforce")
    r.limitations.append("Gleska stores the offered maximum daily wage per job, not agreed wages or payroll, so the wage "
                         "figure is an upper bound, not salary paid.")
    if missing:
        r.limitations.append(f"{missing} active assignment(s) have no maximum daily wage set and are excluded from the wage figure.")
    r.row_count = len(jobs.rows) + len(matches.rows)
    return r


def attendance_summary(ctx: OrgContext, args: TopArgs) -> ToolResult:
    r = ToolResult("attendance_summary")
    period = args.period.resolve(ctx.as_of)
    filters = [("lt", "attendance_date", period.end.isoformat())]
    if period.start:
        filters.append(("gte", "attendance_date", period.start.isoformat()))
    rows = fetch("attendance", ["id", "worker_profile_id", "attendance_date", "status", "updated_at"],
                 employer_id=ctx.employer_id, filters=filters)
    _truncation(r, rows)
    updated = _latest(rows.rows, "updated_at")
    for status in ("PRESENT", "LATE", "ABSENT"):
        hit = [x for x in rows.rows if x.get("status") == status]
        _count_ev(r, f"Attendance records marked {status}", f"attendance.{status.lower()}", len(hit), "attendance",
                  _ids(hit), period.label, "hiring", f"count attendance where status = {status} and date in period",
                  updated, ["attendance.status", "attendance.attendance_date"])
    issues: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for x in rows.rows:
        if x.get("status") in ("LATE", "ABSENT") and x.get("worker_profile_id"):
            issues[str(x["worker_profile_id"])].append(x)
    ranked = sorted(issues.items(), key=lambda kv: (-len(kv[1]), kv[0]))[: args.top_n]
    names = _worker_names([w for w, _ in ranked])
    for worker, recs in ranked:
        late = sum(1 for x in recs if x["status"] == "LATE")
        r.add(Evidence(label=f"Attendance issues – {names.get(worker, 'worker ' + worker[:8])}",
                       value=f"{len(recs)} (late {late}, absent {len(recs) - late})", numeric=Decimal(len(recs)),
                       unit="count", metric="attendance.issues_by_worker", period=period.label, source_agent="hiring",
                       source_table="attendance", record_ids=_ids(recs), record_count=len(recs),
                       fields=["attendance.status"], source_updated_at=updated, classification="employee"))
    if not rows.rows:
        r.limitations.append("No attendance records exist for this period.")
    r.row_count = len(rows.rows)
    return r


def _worker_names(worker_profile_ids: list[str]) -> dict[str, str]:
    if not worker_profile_ids:
        return {}
    profiles = fetch("worker_profiles", ["id", "user_id"], employer_id=None, filters=[("in", "id", worker_profile_ids)]).rows
    users = fetch("users", ["id", "name"], employer_id=None,
                  filters=[("in", "id", [str(p["user_id"]) for p in profiles if p.get("user_id")])]).rows
    name_by_user = {str(u["id"]): u.get("name") for u in users}
    return {str(p["id"]): name_by_user.get(str(p.get("user_id"))) or f"worker {str(p['id'])[:8]}" for p in profiles}


# ------------------------------------------------------------------ receivables

def _invoices_with_paid(ctx: OrgContext):
    invoices = fetch("financial_invoices", ["id", "invoice_number", "client_name", "issue_date", "due_date",
                                            "currency", "total", "status", "updated_at"],
                     employer_id=ctx.employer_id, filters=[("eq", "status", "GENERATED")])
    payments = fetch("financial_invoice_payments", ["id", "invoice_id", "amount", "payment_date", "created_at"],
                     employer_id=ctx.employer_id)
    paid: dict[str, Decimal] = defaultdict(Decimal)
    for p in payments.rows:
        paid[str(p["invoice_id"])] += dec(p.get("amount"))
    return invoices, payments, paid


def receivables_summary(ctx: OrgContext, args: PeriodArgs) -> ToolResult:
    r = ToolResult("receivables_summary")
    period = args.period.resolve(ctx.as_of)
    invoices, payments, paid = _invoices_with_paid(ctx)
    _truncation(r, invoices, payments)
    currency_of = {str(i["id"]): (i.get("currency") or "INR") for i in invoices.rows}
    updated = _latest(invoices.rows + payments.rows, "updated_at", "created_at")

    invoiced, inv_ids = defaultdict(Decimal), defaultdict(list)
    outstanding, out_ids = defaultdict(Decimal), defaultdict(list)
    overdue, over_ids = defaultdict(Decimal), defaultdict(list)
    today = ctx.as_of.isoformat()
    for inv in invoices.rows:
        cur = inv.get("currency") or "INR"
        iid = str(inv["id"])
        if _in_period(inv.get("issue_date"), period):
            invoiced[cur] += dec(inv.get("total"))
            inv_ids[cur].append(iid)
        remaining = max(dec(inv.get("total")) - paid.get(iid, Decimal(0)), Decimal(0))
        if remaining > 0:
            outstanding[cur] += remaining
            out_ids[cur].append(iid)
            if inv.get("due_date") and str(inv["due_date"]) < today:
                overdue[cur] += remaining
                over_ids[cur].append(iid)
    received, rec_ids = defaultdict(Decimal), defaultdict(list)
    for p in payments.rows:
        cur = currency_of.get(str(p["invoice_id"]))
        if cur and _in_period(p.get("payment_date"), period):
            received[cur] += dec(p.get("amount"))
            rec_ids[cur].append(str(p["id"]))

    _money_evs(r, "Invoiced to customers", "receivables.invoiced", dict(invoiced), inv_ids, "financial_invoices",
               period.label, "financial", "sum(total) of GENERATED invoices with issue_date in period",
               updated, ["financial_invoices.total", "issue_date", "status"])
    _money_evs(r, "Customer payments received", "receivables.received", dict(received), rec_ids,
               "financial_invoice_payments", period.label, "financial", "sum(amount) with payment_date in period",
               updated, ["financial_invoice_payments.amount", "payment_date"])
    _money_evs(r, "Outstanding receivables (owed to you)", "receivables.outstanding", dict(outstanding), out_ids,
               "financial_invoices", f"as of {today}", "financial",
               "sum over GENERATED invoices of max(total - payments, 0)", updated,
               ["financial_invoices.total", "financial_invoice_payments.amount"])
    _money_evs(r, "Overdue receivables", "receivables.overdue", dict(overdue), over_ids, "financial_invoices",
               f"as of {today}", "financial", "outstanding where due_date < today", updated,
               ["financial_invoices.due_date"])
    _count_ev(r, "Unpaid or partly paid invoices", "receivables.open_invoices", sum(len(v) for v in out_ids.values()),
              "financial_invoices", [i for v in out_ids.values() for i in v], f"as of {today}", "financial",
              "count GENERATED invoices with remaining amount > 0", updated, ["financial_invoices.status"])
    r.row_count = len(invoices.rows) + len(payments.rows)
    return r


def receivables_by_customer(ctx: OrgContext, args: TopArgs) -> ToolResult:
    r = ToolResult("receivables_by_customer")
    invoices, payments, paid = _invoices_with_paid(ctx)
    _truncation(r, invoices, payments)
    by_client: dict[tuple[str, str], tuple[Decimal, list[str]]] = {}
    for inv in invoices.rows:
        remaining = max(dec(inv.get("total")) - paid.get(str(inv["id"]), Decimal(0)), Decimal(0))
        if remaining <= 0:
            continue
        key = ((inv.get("client_name") or "(no customer name)").strip(), inv.get("currency") or "INR")
        total, ids = by_client.get(key, (Decimal(0), []))
        by_client[key] = (total + remaining, ids + [str(inv["id"])])
    ranked = sorted(by_client.items(), key=lambda kv: (-kv[1][0], kv[0]))[: args.top_n]
    updated = _latest(invoices.rows, "updated_at")
    for (client, cur), (total, ids) in ranked:
        value = money(total)
        calc = Calculation(metric="receivables.by_customer", formula="sum of remaining amount per client_name",
                           result=str(value), unit=cur, period=f"as of {ctx.as_of.isoformat()}",
                           input_table="financial_invoices", input_record_ids=ids, input_count=len(ids))
        r.add(Evidence(label=f"Outstanding from {client}", value=format_amount(value, cur), numeric=value, unit=cur,
                       metric="receivables.by_customer", period=f"as of {ctx.as_of.isoformat()}",
                       source_agent="financial", source_table="financial_invoices", record_ids=ids,
                       record_count=len(ids), fields=["client_name", "total"], source_updated_at=updated), calc)
    if not ranked:
        r.limitations.append("No outstanding customer invoices were found.")
    r.limitations.append("Customers are grouped by the exact name typed on each invoice; Gleska has no customer master.")
    r.row_count = len(invoices.rows)
    return r


# ------------------------------------------------------------------ spending

def supplier_bills_summary(ctx: OrgContext, args: TopArgs) -> ToolResult:
    r = ToolResult("supplier_bills_summary")
    period = args.period.resolve(ctx.as_of)
    bills = fetch("financial_vendor_bills", ["id", "vendor_name", "bill_date", "currency", "total", "confirmed_at"],
                  employer_id=ctx.employer_id)
    _truncation(r, bills)
    totals, ids = defaultdict(Decimal), defaultdict(list)
    by_vendor: dict[tuple[str, str], tuple[Decimal, list[str]]] = {}
    unknown, undated = [], 0
    for b in bills.rows:
        when = b.get("bill_date") or b.get("confirmed_at")
        if not b.get("bill_date"):
            undated += 1 if _in_period(when, period) else 0
        if not _in_period(when, period):
            continue
        if b.get("total") is None:
            unknown.append(str(b["id"]))
            continue
        cur = b.get("currency") or "INR"
        totals[cur] += dec(b["total"])
        ids[cur].append(str(b["id"]))
        key = ((b.get("vendor_name") or "(unknown supplier)").strip(), cur)
        t, i = by_vendor.get(key, (Decimal(0), []))
        by_vendor[key] = (t + dec(b["total"]), i + [str(b["id"])])
    updated = _latest(bills.rows, "confirmed_at")
    _money_evs(r, "Recorded supplier bills", "spend.supplier_bills", dict(totals), ids, "financial_vendor_bills",
               period.label, "financial", "sum(total) of confirmed supplier bills by bill_date (else confirmation date)",
               updated, ["financial_vendor_bills.total", "bill_date"])
    for (vendor, cur), (t, i) in sorted(by_vendor.items(), key=lambda kv: (-kv[1][0], kv[0]))[: args.top_n]:
        value = money(t)
        r.add(Evidence(label=f"Supplier bills from {vendor}", value=format_amount(value, cur), numeric=value, unit=cur,
                       metric="spend.supplier_bills_by_vendor", period=period.label, source_agent="financial",
                       source_table="financial_vendor_bills", record_ids=i, record_count=len(i),
                       fields=["vendor_name", "total"], source_updated_at=updated))
    if unknown:
        r.limitations.append(f"{len(unknown)} supplier bill(s) in this period have no total amount and are not included.")
    if undated:
        r.limitations.append(f"{undated} bill(s) have no bill date; their confirmation date was used.")
    r.limitations.append("Supplier bills have no paid/unpaid status in Gleska, so these are recorded bills, not payments made.")
    r.row_count = len(bills.rows)
    return r


def platform_payments(ctx: OrgContext, args: PeriodArgs) -> ToolResult:
    r = ToolResult("platform_payments")
    period = args.period.resolve(ctx.as_of)
    rows = fetch("payment_transactions", ["id", "amount", "currency", "status", "payment_category",
                                          "payment_success_at", "updated_at"],
                 employer_id=ctx.employer_id, filters=[("eq", "status", "SUCCESS")])
    hit = [x for x in rows.rows if _in_period(x.get("payment_success_at"), period)]
    totals, ids = defaultdict(Decimal), defaultdict(list)
    for x in hit:
        totals[x.get("currency") or "INR"] += dec(x.get("amount"))
        ids[x.get("currency") or "INR"].append(str(x["id"]))
    _money_evs(r, "Paid to Gleska (subscriptions and commissions)", "spend.platform_payments", dict(totals), ids,
               "payment_transactions", period.label, "payments", "sum(amount) where status = SUCCESS and paid in period",
               _latest(rows.rows, "updated_at"), ["amount", "status", "payment_success_at"])
    credits = []
    if ctx.account_id:
        credits = [x for x in fetch("credit_purchase_orders", ["id", "amount_inr", "status", "paid_at"], employer_id=None,
                                    filters=[("eq", "account_id", ctx.account_id), ("eq", "status", "PAID")]).rows
                   if _in_period(x.get("paid_at"), period)]
    _money_evs(r, "AI credits purchased", "spend.ai_credits_purchased",
               {"INR": sum((dec(x["amount_inr"]) for x in credits), Decimal(0))} if credits else {},
               {"INR": _ids(credits)}, "credit_purchase_orders", period.label, "billing",
               "sum(amount_inr) where status = PAID and paid in period", _latest(credits, "paid_at"), ["amount_inr", "paid_at"])
    r.row_count = len(rows.rows) + len(credits)
    return r


# ------------------------------------------------------------------ procurement

def _po_value(po: dict[str, Any]) -> Decimal:
    return dec(po.get("unit_price")) * dec(po.get("quantity"))


def _org_pos(ctx: OrgContext):
    return fetch("procurement_purchase_orders", ["id", "order_reference", "supplier_company_id", "item_name", "quantity",
                                                 "unit", "unit_price", "currency", "status", "created_at", "updated_at",
                                                 "estimated_delivery_date", "delivery_date"],
                 employer_id=ctx.employer_id)


def procurement_summary(ctx: OrgContext, args: PeriodArgs) -> ToolResult:
    r = ToolResult("procurement_summary")
    period = args.period.resolve(ctx.as_of)
    pos = _org_pos(ctx)
    rfqs = fetch("procurement_rfqs", ["id", "status", "quotation_deadline", "updated_at"], employer_id=ctx.employer_id,
                 filters=[("eq", "status", "OPEN")])
    _truncation(r, pos, rfqs)
    updated = _latest(pos.rows, "updated_at")
    unknown = [p for p in pos.rows if p.get("status") not in PO_STATUSES]
    for name, statuses, metric, period_label, date_filter in (
        ("Open purchase-order commitments (accepted, not fully delivered)", PO_OPEN, "procurement.open_commitments", "as of today", None),
        ("Purchase orders awaiting supplier acceptance", PO_AWAITING, "procurement.awaiting_supplier", "as of today", None),
        ("Delivered purchase orders", ("DELIVERED",), "procurement.delivered_value", period.label, "delivery"),
    ):
        hit = [p for p in pos.rows if p.get("status") in statuses
               and (date_filter is None or _in_period(p.get("delivery_date") or p.get("updated_at"), period))]
        totals, ids = defaultdict(Decimal), defaultdict(list)
        for p in hit:
            totals[p.get("currency") or "INR"] += _po_value(p)
            ids[p.get("currency") or "INR"].append(str(p["id"]))
        _money_evs(r, name, metric, dict(totals), ids, "procurement_purchase_orders", period_label, "procurement",
                   f"sum(unit_price * quantity) where status in {statuses}", updated,
                   ["unit_price", "quantity", "status"], classification="financial")
        _count_ev(r, f"{name} – number of orders", f"{metric}_count", len(hit), "procurement_purchase_orders",
                  _ids(hit), period_label, "procurement", f"count where status in {statuses}", updated, ["status"])
    bad = [p for p in pos.rows if p.get("status") in PO_CLOSED_BAD]
    _count_ev(r, "Cancelled or rejected orders (excluded from commitments)", "procurement.cancelled_or_rejected",
              len(bad), "procurement_purchase_orders", _ids(bad), "all time", "procurement",
              "count where status in (CANCELLED, REJECTED)", updated, ["status"])
    _count_ev(r, "Open RFQs collecting quotations", "procurement.open_rfqs", len(rfqs.rows), "procurement_rfqs",
              _ids(rfqs.rows), "as of today", "procurement", "count RFQ where status = OPEN",
              _latest(rfqs.rows, "updated_at"), ["procurement_rfqs.status"])
    if unknown:
        r.conflicts.append(f"{len(unknown)} purchase order(s) have an unrecognised status and were not counted.")
    r.limitations.append("Purchase-order values are unit price × quantity, excluding tax (Gleska stores no PO total).")
    r.limitations.append("Gleska has no internal approval step for purchase orders; 'awaiting' means awaiting the supplier.")
    r.row_count = len(pos.rows) + len(rfqs.rows)
    return r


def procurement_by_supplier(ctx: OrgContext, args: ProcurementSupplierArgs) -> ToolResult:
    r = ToolResult("procurement_by_supplier")
    period = args.period.resolve(ctx.as_of)
    groups = {"open": PO_OPEN, "awaiting_supplier": PO_AWAITING, "delivered": ("DELIVERED",),
              "all_active": PO_OPEN + PO_AWAITING + ("DELIVERED",)}
    statuses = groups[args.status_group]
    pos = _org_pos(ctx)
    hit = [p for p in pos.rows if p.get("status") in statuses and _in_period(p.get("created_at"), period)]
    names = {str(s["id"]): s.get("name") for s in fetch(
        "supplier_companies", ["id", "name"], employer_id=None,
        filters=[("in", "id", list({str(p["supplier_company_id"]) for p in hit if p.get("supplier_company_id")}))]).rows}
    agg: dict[tuple[str, str], tuple[Decimal, list[str]]] = {}
    for p in hit:
        key = (names.get(str(p.get("supplier_company_id"))) or "(unknown supplier)", p.get("currency") or "INR")
        t, i = agg.get(key, (Decimal(0), []))
        agg[key] = (t + _po_value(p), i + [str(p["id"])])
    updated = _latest(pos.rows, "updated_at")
    for (supplier, cur), (t, i) in sorted(agg.items(), key=lambda kv: (-kv[1][0], kv[0]))[: args.top_n]:
        value = money(t)
        calc = Calculation(metric="procurement.by_supplier", formula=f"sum(unit_price * quantity) where status in {statuses}",
                           result=str(value), unit=cur, period=period.label, input_table="procurement_purchase_orders",
                           input_record_ids=i, input_count=len(i))
        r.add(Evidence(label=f"Purchase orders with {supplier} ({len(i)} order(s))", value=format_amount(value, cur),
                       numeric=value, unit=cur, metric="procurement.by_supplier", period=period.label,
                       source_agent="procurement", source_table="procurement_purchase_orders", record_ids=i,
                       record_count=len(i), fields=["supplier_company_id", "unit_price", "quantity"],
                       source_updated_at=updated), calc)
    if not agg:
        r.limitations.append("No purchase orders match these filters.")
    r.limitations.append("Values exclude tax; period filter uses the order creation date.")
    r.row_count = len(pos.rows)
    return r


def delayed_deliveries(ctx: OrgContext, args: TopArgs) -> ToolResult:
    r = ToolResult("delayed_deliveries")
    pos = _org_pos(ctx)
    today = ctx.as_of.isoformat()
    late = [p for p in pos.rows if p.get("status") in PO_OPEN and p.get("estimated_delivery_date")
            and str(p["estimated_delivery_date"]) < today]
    no_eta = [p for p in pos.rows if p.get("status") in PO_OPEN and not p.get("estimated_delivery_date")]
    updated = _latest(pos.rows, "updated_at")
    _count_ev(r, "Purchase orders past their estimated delivery date", "procurement.delayed_deliveries", len(late),
              "procurement_purchase_orders", _ids(late), f"as of {today}", "procurement",
              "count open orders with estimated_delivery_date < today", updated, ["estimated_delivery_date", "status"])
    for p in sorted(late, key=lambda x: str(x["estimated_delivery_date"]))[: args.top_n]:
        r.add(Evidence(label=f"Delayed order {p.get('order_reference') or p['id']}: {p.get('item_name')}",
                       value=f"expected {p['estimated_delivery_date']}, status {p['status']}",
                       source_agent="procurement", source_table="procurement_purchase_orders", record_ids=[str(p["id"])],
                       record_count=1, fields=["estimated_delivery_date", "status"], source_updated_at=updated,
                       metric="procurement.delayed_order", period=f"as of {today}",
                       detail={"estimated_delivery_date": str(p["estimated_delivery_date"])}))
    if no_eta:
        r.limitations.append(f"{len(no_eta)} open order(s) have no estimated delivery date, so delay cannot be judged.")
    r.limitations.append("These are purchase-order deliveries from suppliers, not logistics-agent shipments.")
    r.row_count = len(pos.rows)
    return r


# ------------------------------------------------------------------ AI, profile, logistics, unavailable

def ai_usage(ctx: OrgContext, args: PeriodArgs) -> ToolResult:
    r = ToolResult("ai_usage")
    period = args.period.resolve(ctx.as_of)
    if not ctx.account_id:
        r.limitations.append("No AI billing account exists for this organisation yet.")
        return r
    wallet = fetch("credit_wallets", ["account_id", "available", "reserved", "updated_at"], employer_id=None,
                   filters=[("eq", "account_id", ctx.account_id)]).rows
    if wallet:
        value = dec(wallet[0]["available"])
        r.add(Evidence(label="AI credits available", value=str(value.normalize()), numeric=value, unit="credits",
                       metric="ai.balance", period="as of now", source_agent="billing", source_table="credit_wallets",
                       record_ids=[ctx.account_id], record_count=1, fields=["available"],
                       source_updated_at=wallet[0].get("updated_at")))
    filters = [("eq", "account_id", ctx.account_id), ("lt", "started_at", period.end_ts())]
    if period.start:
        filters.append(("gte", "started_at", period.start_ts()))
    events = fetch("ai_usage_events", ["id", "executing_agent", "credits_charged", "started_at"], employer_id=None,
                   filters=filters)
    per_agent: dict[str, Decimal] = defaultdict(Decimal)
    for e in events.rows:
        per_agent[str(e.get("executing_agent"))] += dec(e.get("credits_charged"))
    for agent, total in sorted(per_agent.items(), key=lambda kv: -kv[1]):
        r.add(Evidence(label=f"AI credits used by {agent}", value=str(total.normalize()), numeric=total, unit="credits",
                       metric="ai.usage", period=period.label, source_agent="billing", source_table="ai_usage_events",
                       record_count=sum(1 for e in events.rows if str(e.get("executing_agent")) == agent),
                       fields=["credits_charged"]))
    r.row_count = len(events.rows)
    return r


def company_profile(ctx: OrgContext, _: NoArgs) -> ToolResult:
    r = ToolResult("company_profile")
    rows = fetch("employer_onboarding_details", ["business_name", "business_type", "industry_category", "industry_type",
                                                 "city", "state", "updated_at"], employer_id=ctx.employer_id).rows
    if not rows:
        r.limitations.append("No company profile details have been entered.")
        return r
    p = rows[0]
    for key, label in (("business_name", "Business name"), ("industry_category", "Industry"),
                       ("industry_type", "Industry type"), ("business_type", "Business type"), ("city", "City"),
                       ("state", "State")):
        if p.get(key):
            r.add(Evidence(label=label, value=str(p[key]), source_agent="profile", source_table="employer_onboarding_details",
                           fields=[key], source_type="profile", source_updated_at=p.get("updated_at")))
    return r


def logistics_summary(ctx: OrgContext, _: NoArgs) -> ToolResult:
    r = ToolResult("logistics_summary")
    listings = fetch("logistics_vehicle_listings", ["id", "status", "price_amount", "price_unit", "updated_at"],
                     employer_id=ctx.employer_id, filters=[("neq", "status", "ARCHIVED")])
    requests = fetch("logistics_rental_requests", ["id", "status", "offered_price", "price_unit", "pickup_date",
                                                   "destination_location", "updated_at"], employer_id=ctx.employer_id)
    _truncation(r, listings, requests)
    updated = _latest(listings.rows + requests.rows, "updated_at")
    for status in ("ACTIVE", "DISPATCHED", "MAINTENANCE"):
        hit = [v for v in listings.rows if v.get("status") == status]
        _count_ev(r, f"Your vehicles listed for lending – {status.lower()}", f"logistics.listings_{status.lower()}",
                  len(hit), "logistics_vehicle_listings", _ids(hit), "as of today", "logistics",
                  f"count listings where status = {status}", updated, ["status"])
    open_requests = [q for q in requests.rows if q.get("status") in ("SUBMITTED", "CONFIRMED", "IN_TRANSIT")]
    for status in ("SUBMITTED", "CONFIRMED", "IN_TRANSIT", "COMPLETED"):
        hit = [q for q in requests.rows if q.get("status") == status]
        _count_ev(r, f"Vehicle rental requests you made – {status.lower().replace('_', ' ')}",
                  f"logistics.requests_{status.lower()}", len(hit), "logistics_rental_requests", _ids(hit),
                  "as of today", "logistics", f"count rental requests where status = {status}", updated, ["status"])
    by_unit: dict[str, Decimal] = defaultdict(Decimal)
    ids_by_unit: dict[str, list[str]] = defaultdict(list)
    for q in open_requests:
        if q.get("offered_price") is not None and q.get("price_unit"):
            by_unit[q["price_unit"]] += dec(q["offered_price"])
            ids_by_unit[q["price_unit"]].append(str(q["id"]))
    for unit, total in sorted(by_unit.items()):
        value = money(total)
        calc = Calculation(metric="logistics.open_request_rates", formula="sum(offered_price) of open rental requests "
                           f"priced {unit}", result=str(value), unit=f"INR {unit}", period="as of today",
                           input_table="logistics_rental_requests", input_record_ids=ids_by_unit[unit],
                           input_count=len(ids_by_unit[unit]))
        r.add(Evidence(label=f"Offered transport rates on open rental requests ({unit})", value=f"{format_amount(value, 'INR')} {unit}",
                       numeric=value, unit=f"INR {unit}", metric="logistics.open_request_rates", period="as of today",
                       source_agent="logistics", source_table="logistics_rental_requests", record_ids=ids_by_unit[unit],
                       record_count=len(ids_by_unit[unit]), fields=["offered_price", "price_unit"],
                       source_updated_at=updated), calc)
    r.limitations.append("Logistics records are vehicle listings and rental requests entered in the Logistics agent. "
                         "Rates are per unit (day/trip/km/ton) and rental durations are free text, so total transport "
                         "cost cannot be calculated; trips and deliveries are not tracked.")
    r.row_count = len(listings.rows) + len(requests.rows)
    return r


UNAVAILABLE_REASONS = {
    "tender": "Tender Filing and Tender Tracking are not yet connected to stored data in Gleska, so there are no tender "
              "records (active tenders, pipeline value, deadlines, documents or results).",
    "maintenance": "The Industrial Maintenance agent is not built yet, so there are no machine or maintenance records.",
    "payroll": "Gleska does not record payroll or salary payments. Only each job's offered maximum daily wage is stored.",
    "departments": "Gleska records have no department field, so nothing can be broken down by department.",
    "expenses_other": "Apart from scanned supplier bills and payments to Gleska, no expenses are recorded.",
    "payables": "Supplier bills have no paid/unpaid status, so outstanding payables cannot be calculated.",
    "customers_master": "Gleska has no customer list; customers appear only as names typed on invoices.",
}


def unavailable_domain(ctx: OrgContext, args: UnavailableArgs) -> ToolResult:
    r = ToolResult("unavailable_domain")
    r.add(Evidence(label=f"{args.domain} data", value="not available", source_agent=args.domain, source_table="(none)",
                   source_type="unavailable", detail={"reason": UNAVAILABLE_REASONS[args.domain]}))
    r.limitations.append(UNAVAILABLE_REASONS[args.domain])
    return r


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    args: type[BaseModel]
    run: Callable[[OrgContext, Any], ToolResult]
    comparable: bool = False


TOOLS: dict[str, Tool] = {t.name: t for t in (
    Tool("workforce_summary", "Current workforce: active/engaged workers, pending candidates, open jobs, unfilled positions, daily wage upper bound.", NoArgs, workforce_summary),
    Tool("attendance_summary", "Attendance counts (present/late/absent) in a period and workers with most attendance issues.", TopArgs, attendance_summary, True),
    Tool("receivables_summary", "Invoiced, received, outstanding and overdue customer money.", PeriodArgs, receivables_summary, True),
    Tool("receivables_by_customer", "Outstanding amounts per customer.", TopArgs, receivables_by_customer),
    Tool("supplier_bills_summary", "Recorded supplier bills in a period and top suppliers by bill value.", TopArgs, supplier_bills_summary, True),
    Tool("platform_payments", "Payments made to Gleska (subscriptions, commissions) and AI credits purchased.", PeriodArgs, platform_payments, True),
    Tool("procurement_summary", "Purchase-order commitments, orders awaiting suppliers, delivered value, open RFQs.", PeriodArgs, procurement_summary, True),
    Tool("procurement_by_supplier", "Purchase-order value per supplier.", ProcurementSupplierArgs, procurement_by_supplier, True),
    Tool("delayed_deliveries", "Open purchase orders past their estimated delivery date.", TopArgs, delayed_deliveries),
    Tool("ai_usage", "AI credit balance and credits used per agent in a period.", PeriodArgs, ai_usage, True),
    Tool("company_profile", "Business name, industry and location.", NoArgs, company_profile),
    Tool("logistics_summary", "Logistics agent: your vehicle listings by status and vehicle rental requests by status with offered rates.", NoArgs, logistics_summary),
    Tool("unavailable_domain", "Use for tenders, maintenance, payroll, departments, other expenses, payables or a customer list: explains that the data does not exist.", UnavailableArgs, unavailable_domain),
)}
