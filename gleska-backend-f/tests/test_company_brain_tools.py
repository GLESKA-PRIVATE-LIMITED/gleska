"""Structured engine: every metric matches hand-computed ground truth and stays inside its organisation."""

from datetime import date
from decimal import Decimal

import pytest

from app.company_brain import data_access
from app.company_brain.data_access import DataAccessError, fetch
from app.company_brain.evidence import format_amount
from app.company_brain.periods import Period, PeriodSpec
from app.company_brain.tools import TOOLS, OrgContext
from tests.company_brain_fixtures import ACC_A, EXPECTED, ORG_A, ORG_B, TODAY, USER_A, USER_B, FakeDB


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    monkeypatch.setattr(data_access, "supabase", fake)
    return fake


CTX_A = OrgContext(employer_id=ORG_A, user_id=USER_A, account_id=ACC_A, today=TODAY)
CTX_B = OrgContext(employer_id=ORG_B, user_id=USER_B, account_id="acc-b", today=TODAY)
MONTH = {"period": {"name": "this_month"}}


def run(tool, ctx=CTX_A, args=None):
    t = TOOLS[tool]
    return t.run(ctx, t.args.model_validate(args or {}))


def scalars(*results):
    out = {}
    for r in results:
        out.update({k: v[0] for k, v in r.scalars.items()})
    return out


def test_metrics_match_hand_computed_ground_truth(db):
    got = scalars(
        run("workforce_summary"), run("attendance_summary", args=MONTH), run("receivables_summary", args=MONTH),
        run("supplier_bills_summary", args=MONTH), run("platform_payments", args=MONTH),
        run("procurement_summary", args=MONTH), run("delayed_deliveries"), run("logistics_summary"),
    )
    mismatches = {k: (v, got.get(k)) for k, v in EXPECTED.items() if got.get(k) != v}
    assert mismatches == {}


def test_every_number_has_a_calculation_record_with_inputs(db):
    r = run("receivables_summary", args=MONTH)
    calc_by_id = {c.id: c for c in r.calculations}
    outstanding = next(e for e in r.evidence if e.metric == "receivables.outstanding" and e.unit == "INR")
    calc = calc_by_id[outstanding.calculation_id]
    assert (calc.result, sorted(calc.input_record_ids), calc.unit) == ("11000.50", ["i1", "i2"], "INR")
    assert outstanding.value == "₹11,000.50" and outstanding.source_table == "financial_invoices"


def test_currencies_are_never_summed_together(db):
    r = run("receivables_summary", args=MONTH)
    units = {e.unit for e in r.evidence if e.metric == "receivables.outstanding"}
    assert units == {"INR", "USD"}


def test_drafts_cancelled_and_other_org_rows_are_excluded(db):
    got = scalars(run("receivables_summary", args=MONTH), run("procurement_summary", args=MONTH))
    assert got["receivables.invoiced:INR"] == Decimal("15000.50")  # draft 999999 excluded
    assert got["procurement.open_commitments:INR"] == Decimal("125050.00")  # cancelled + org B excluded


def test_organisation_b_sees_only_its_own_data(db):
    got = scalars(run("workforce_summary", CTX_B), run("receivables_summary", CTX_B, MONTH))
    assert got["workforce.active_workers"] == 1 and got["receivables.outstanding:INR"] == Decimal("777777.00")
    names = [e.label for e in run("attendance_summary", CTX_A, MONTH).evidence]
    assert not any("Other Org Worker" in n for n in names)


def test_attendance_issue_ranking_uses_real_names(db):
    r = run("attendance_summary", args=MONTH)
    issues = [e for e in r.evidence if e.metric == "attendance.issues_by_worker"]
    assert [(e.label, e.value) for e in issues] == [
        ("Attendance issues – Ravi Kumar", "2 (late 1, absent 1)"),
        ("Attendance issues – Sita Devi", "1 (late 1, absent 0)"),
    ]


def test_supplier_ranking_and_unknown_amount_disclosed(db):
    r = run("procurement_by_supplier", args={"period": {"name": "this_month"}, "status_group": "all_active", "top_n": 3})
    assert [(e.label.split(" (")[0], e.numeric) for e in r.evidence] == [
        ("Purchase orders with SteelCo", Decimal("98000.00")),   # po2 90000 + po4 8000
        ("Purchase orders with BuildMart", Decimal("45050.00")),  # po1 35050 + po3 10000 (po5 cancelled)
    ]
    bills = run("supplier_bills_summary", args=MONTH)
    assert any("no total amount" in x for x in bills.limitations)


def test_unavailable_domains_return_explicit_reason(db):
    r = run("unavailable_domain", args={"domain": "tender"})
    assert r.evidence[0].source_type == "unavailable" and "Tender" in r.limitations[0]
    assert db.queries == []  # nothing is queried for unavailable data


def test_data_access_allowlist_blocks_unapproved_tables_columns_and_unscoped_reads(db):
    with pytest.raises(DataAccessError):
        fetch("user_sessions", ["id"], employer_id=ORG_A)
    with pytest.raises(DataAccessError):
        fetch("users", ["mobile"], employer_id=None, filters=[("in", "id", ["x"])])
    with pytest.raises(DataAccessError):
        fetch("jobs", ["id"], employer_id=None)  # organisation filter is mandatory
    with pytest.raises(DataAccessError):
        fetch("worker_profiles", ["id"], employer_id=None)  # shared table without id filter
    with pytest.raises(DataAccessError):
        fetch("jobs", ["id"], employer_id=ORG_A, filters=[("like", "title", "%")])


def test_tool_arguments_are_validated(db):
    with pytest.raises(Exception):
        TOOLS["receivables_by_customer"].args.model_validate({"top_n": 500})
    with pytest.raises(Exception):
        TOOLS["unavailable_domain"].args.model_validate({"domain": "secrets"})
    assert "employer_id" not in TOOLS["receivables_summary"].args.model_fields


def test_periods_are_india_calendar_ranges():
    t = date(2026, 10, 31)
    assert PeriodSpec(name="this_month").resolve(t) == Period("this_month", date(2026, 10, 1), date(2026, 11, 1))
    assert PeriodSpec(name="last_month").resolve(t) == Period("last_month", date(2026, 9, 1), date(2026, 10, 1))
    lm = PeriodSpec(name="last_month").resolve(t)
    assert lm.previous() == Period("before_last_month", date(2026, 8, 1), date(2026, 9, 1))
    mtd = PeriodSpec(name="this_month").resolve(date(2026, 10, 15))
    assert mtd.previous() == Period("before_this_month", date(2026, 9, 1), date(2026, 9, 16))
    assert PeriodSpec(name="last_quarter").resolve(t) == Period("last_quarter", date(2026, 7, 1), date(2026, 10, 1))
    with pytest.raises(Exception):
        PeriodSpec(name="custom", start=date(2026, 10, 5), end_inclusive=date(2026, 10, 1))


def test_indian_amount_formatting():
    assert format_amount(Decimal("12345678.5"), "INR") == "₹1,23,45,678.50"
    assert format_amount(Decimal("999"), "INR") == "₹999.00"
    assert format_amount(Decimal("1234.5"), "USD") == "1,234.50 USD"


def test_logistics_rates_are_never_mixed_across_units(db):
    r = run("logistics_summary")
    rates = {e.unit: e.numeric for e in r.evidence if e.metric == "logistics.open_request_rates"}
    assert rates == {"INR per day": Decimal("4500.50"), "INR per km": Decimal("55.00")}  # q3 completed excluded
