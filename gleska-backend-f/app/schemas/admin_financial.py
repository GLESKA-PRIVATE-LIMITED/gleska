"""Read-only Super Admin views of persisted financial records."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Currency = Literal["INR", "USD", "EUR"]


class AdminFinancialModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AdminFinancialCurrencyAmount(AdminFinancialModel):
    currency: Currency
    amount: Decimal


class AdminFinancialOverview(AdminFinancialModel):
    generated_invoice_count: int
    invoiced_by_currency: list[AdminFinancialCurrencyAmount]
    outstanding_invoice_count: int
    outstanding_by_currency: list[AdminFinancialCurrencyAmount]
    overdue_invoice_count: int
    overdue_by_currency: list[AdminFinancialCurrencyAmount]
    payment_count: int
    payments_by_currency: list[AdminFinancialCurrencyAmount]
    active_vendor_count: int
    vendor_bill_count: int
    vendor_bill_totals_by_currency: list[AdminFinancialCurrencyAmount]
    audit_runs_available: bool
    audit_run_count: int
    completed_audit_run_count: int
    failed_audit_run_count: int
    running_audit_run_count: int
    passed_check_count: int
    failed_check_count: int
    finding_count: int


class AdminFinancialEmployer(AdminFinancialModel):
    id: str
    name: str


class AdminFinancialInvoice(AdminFinancialModel):
    id: str
    employer: AdminFinancialEmployer
    invoice_number: str
    client_name: str
    issue_date: date
    due_date: date
    currency: Currency
    status: Literal["DRAFT", "GENERATED"]
    subtotal: Decimal
    tax_rate: Decimal
    tax_amount: Decimal
    total: Decimal
    paid_amount: Decimal
    outstanding_amount: Decimal
    is_overdue: bool
    created_at: datetime


class AdminFinancialInvoiceItem(AdminFinancialModel):
    id: str
    description: str
    quantity: Decimal
    unit_price: Decimal
    line_total: Decimal


class AdminFinancialInvoiceDetail(AdminFinancialInvoice):
    payment_terms_notes: str
    updated_at: datetime
    items: list[AdminFinancialInvoiceItem]


class AdminFinancialInvoicePage(AdminFinancialModel):
    items: list[AdminFinancialInvoice]
    total: int
    page: int
    page_size: int
    total_pages: int


class AdminFinancialPayment(AdminFinancialModel):
    id: str
    employer: AdminFinancialEmployer
    invoice_id: str
    invoice_number: str
    client_name: str
    amount: Decimal
    currency: Currency
    payment_date: date
    payment_reference: str | None = None
    notes: str
    created_at: datetime


class AdminFinancialPaymentPage(AdminFinancialModel):
    items: list[AdminFinancialPayment]
    total: int
    page: int
    page_size: int
    total_pages: int


class AdminFinancialVendor(AdminFinancialModel):
    id: str
    employer: AdminFinancialEmployer
    vendor_name: str
    contact_email: str | None = None
    contact_phone: str | None = None
    address: str | None = None
    tax_identifier: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    bill_count: int
    bill_totals_by_currency: list[AdminFinancialCurrencyAmount]


class AdminFinancialVendorPage(AdminFinancialModel):
    items: list[AdminFinancialVendor]
    total: int
    page: int
    page_size: int
    total_pages: int


class AdminFinancialVendorBill(AdminFinancialModel):
    id: str
    employer: AdminFinancialEmployer
    vendor_id: str | None = None
    vendor_name: str | None = None
    bill_number: str | None = None
    bill_date: date | None = None
    due_date: date | None = None
    currency: Currency | None = None
    subtotal: Decimal | None = None
    tax_amount: Decimal | None = None
    total: Decimal | None = None
    confirmed_at: datetime
    is_assigned: bool


class AdminFinancialVendorBillDetail(AdminFinancialVendorBill):
    line_items: list[dict[str, object]]


class AdminFinancialVendorDetail(AdminFinancialVendor):
    bills: list[AdminFinancialVendorBill]
    bill_page: int
    bill_page_size: int
    bill_total_pages: int


class AdminFinancialVendorBillPage(AdminFinancialModel):
    items: list[AdminFinancialVendorBill]
    total: int
    page: int
    page_size: int
    total_pages: int


class AdminFinancialAuditCheck(AdminFinancialModel):
    id: str
    check_id: str
    title: str
    result: Literal["PASS", "FAIL", "NOT_APPLICABLE"]
    explanation: str
    entity_type: str | None = None
    entity_id: str | None = None
    findings: list[dict[str, object]]
    checked_at: datetime


class AdminFinancialAuditRun(AdminFinancialModel):
    id: str
    employer: AdminFinancialEmployer
    status: Literal["RUNNING", "COMPLETED", "FAILED"]
    started_at: datetime
    completed_at: datetime | None = None
    total_checks: int
    passed_checks: int
    failed_checks: int
    not_applicable_checks: int
    pass_rate: Decimal | None = None
    summary: dict[str, object]
    error_message: str | None = None
    checks: list[AdminFinancialAuditCheck] = Field(default_factory=list)


class AdminFinancialAuditRunPage(AdminFinancialModel):
    items: list[AdminFinancialAuditRun]
    total: int
    page: int
    page_size: int
    total_pages: int
