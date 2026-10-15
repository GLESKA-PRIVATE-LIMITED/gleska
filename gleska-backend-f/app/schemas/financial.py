"""Request and response schemas for employer financial records."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator


class FinancialModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


Currency = Literal["INR", "USD", "EUR"]
InvoiceAction = Literal["save_draft", "generate"]
InvoiceStatus = Literal["DRAFT", "GENERATED"]
MAX_FINANCIAL_SCAN_UPLOAD_BYTES = 25 * 1024 * 1024


class FinancialSettings(FinancialModel):
    base_currency: Currency = "INR"
    tax_identifier: Annotated[str, StringConstraints(max_length=64)] = ""
    auto_reconcile_incoming_bills: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
    document_processing_configured: bool = False
    document_processing_upload_limit_bytes: int = MAX_FINANCIAL_SCAN_UPLOAD_BYTES

    @field_validator("tax_identifier", mode="before")
    @classmethod
    def normalize_tax_identifier(cls, value):
        if isinstance(value, str):
            if any(ord(character) < 32 or ord(character) == 127 for character in value):
                raise ValueError("tax_identifier must not contain control characters")
            return " ".join(value.split())
        return value


class FinancialSettingsUpdate(FinancialModel):
    base_currency: Currency | None = None
    tax_identifier: Annotated[str | None, StringConstraints(max_length=64)] = None
    auto_reconcile_incoming_bills: bool | None = None

    @field_validator("tax_identifier", mode="before")
    @classmethod
    def normalize_tax_identifier(cls, value):
        if isinstance(value, str):
            if any(ord(character) < 32 or ord(character) == 127 for character in value):
                raise ValueError("tax_identifier must not contain control characters")
            return " ".join(value.split())
        return value

    @model_validator(mode="after")
    def validate_supplied_values(self):
        if not self.model_fields_set:
            raise ValueError("At least one financial setting must be provided")
        for field_name in ("base_currency", "auto_reconcile_incoming_bills"):
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} must not be null")
        return self


class InvoiceLineItemInput(FinancialModel):
    description: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    quantity: Decimal = Field(gt=0, le=Decimal("999999999.999"), max_digits=12, decimal_places=3)
    unit_price: Decimal = Field(ge=0, le=Decimal("999999999999.99"), max_digits=14, decimal_places=2)

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("description must not be blank")
        return normalized


class InvoiceCreateRequest(FinancialModel):
    client_name: Annotated[str, StringConstraints(min_length=1, max_length=240)]
    issue_date: date
    due_date: date
    payment_terms_notes: Annotated[str, StringConstraints(max_length=2000)] = ""
    tax_rate: Decimal = Field(ge=0, le=100, max_digits=7, decimal_places=4)
    line_items: list[InvoiceLineItemInput] = Field(min_length=1, max_length=100)
    action: InvoiceAction

    @field_validator("client_name")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("value must not be blank")
        return normalized

    @field_validator("payment_terms_notes")
    @classmethod
    def normalize_notes(cls, value: str) -> str:
        return " ".join(value.split())

    @model_validator(mode="after")
    def validate_date_order(self):
        if self.due_date < self.issue_date:
            raise ValueError("due_date must not be before issue_date")
        return self


class InvoiceLineItemResponse(FinancialModel):
    id: UUID
    description: str
    quantity: float
    unit_price: float
    line_total: float


class InvoiceResponse(FinancialModel):
    id: UUID
    invoice_number: str
    client_name: str
    issue_date: date
    due_date: date
    payment_terms_notes: str
    currency: Currency
    tax_rate: float
    subtotal: float
    tax_amount: float
    total: float
    status: InvoiceStatus
    line_items: list[InvoiceLineItemResponse]
    created_at: datetime
    updated_at: datetime


class FinancialInvoiceCompanyDetails(FinancialModel):
    business_name: str | None = None
    registered_address: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    gstin: str | None = None
    company_email: str | None = None
    company_phone: str | None = None


class InvoiceListResponse(FinancialModel):
    invoices: list[InvoiceResponse]
    company_details: FinancialInvoiceCompanyDetails | None = None


class FinancialCurrencyAmount(FinancialModel):
    currency: Currency
    amount: Decimal


class FinancialReceivableStatus(FinancialModel):
    invoice_id: UUID
    invoice_number: str
    client_name: str
    issue_date: date
    due_date: date
    currency: Currency
    invoice_total: Decimal
    paid_amount: Decimal
    outstanding_amount: Decimal
    payment_status: Literal["UNPAID", "PARTIALLY_PAID", "PAID"]
    is_overdue: bool


class FinancialReceivablesSummary(FinancialModel):
    as_of_date: date
    generated_invoice_count: int
    outstanding_invoice_count: int
    unpaid_count: int
    partially_paid_count: int
    overdue_count: int
    paid_count: int
    outstanding_by_currency: list[FinancialCurrencyAmount]


class FinancialReceivablesResponse(FinancialModel):
    summary: FinancialReceivablesSummary
    invoices: list[FinancialReceivableStatus]


class FinancialPaymentCreateRequest(FinancialModel):
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    payment_date: date
    idempotency_key: UUID
    payment_reference: Annotated[str | None, StringConstraints(max_length=120)] = None
    notes: Annotated[str, StringConstraints(max_length=1000)] = ""

    @field_validator("payment_reference", "notes")
    @classmethod
    def normalize_payment_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split())


class FinancialPaymentRecord(FinancialModel):
    id: UUID
    invoice_id: UUID
    amount: Decimal
    currency: Currency
    payment_date: date
    payment_reference: str | None = None
    notes: str = ""
    idempotency_key: UUID
    created_at: datetime


class FinancialInvoicePaymentsResponse(FinancialModel):
    invoice_id: UUID
    currency: Currency
    invoice_total: Decimal
    paid_amount: Decimal
    outstanding_amount: Decimal
    as_of_date: date
    payments: list[FinancialPaymentRecord]


class FinancialDashboardSummary(FinancialModel):
    total_invoiced: float | None
    total_invoiced_currency: Currency | None = None
    total_invoiced_has_multiple_currencies: bool = False
    pending_receivables: float | None
    pending_receivables_by_currency: list[FinancialCurrencyAmount] = Field(default_factory=list)
    pending_receivable_count: int = 0
    receivables_as_of_date: date
    active_invoices: int
    audits_passed: int | None
    audit_pass_rate: float | None
    latest_audit_failed_checks: int | None = None
    latest_audit_run_id: UUID | None = None
    latest_audit_completed_at: datetime | None = None
    latest_audit_started_at: datetime | None = None
    latest_audit_run_status: Literal["RUNNING", "COMPLETED", "FAILED"] | None = None
    total_audit_runs: int = 0
    active_vendors: int | None


class FinancialDashboardRecord(FinancialModel):
    id: str
    type: Literal["INVOICE", "TRANSACTION", "AUDIT", "VENDOR"]
    title: str
    entity: str
    reference: str
    amount: float | None
    currency: Currency | None = None
    status: str
    date: str
    category: str


class FinancialDashboardResponse(FinancialModel):
    summary: FinancialDashboardSummary
    records: list[FinancialDashboardRecord]


class FinancialAuditRecord(FinancialModel):
    id: UUID
    action: str
    outcome: Literal["SUCCESS", "FAILURE"]
    entity_type: str
    entity_id: UUID | None = None
    actor_user_id: UUID
    metadata: dict[str, object] = Field(default_factory=dict)
    created_at: datetime


class FinancialAuditEventsResponse(FinancialModel):
    audits: list[FinancialAuditRecord] = Field(default_factory=list)


class FinancialAuditCheckResult(FinancialModel):
    id: UUID
    check_id: str
    title: str
    result: Literal["PASS", "FAIL", "NOT_APPLICABLE"]
    explanation: str
    entity_type: str | None = None
    entity_id: UUID | None = None
    findings: list[dict[str, object]] = Field(default_factory=list)
    checked_at: datetime


class FinancialAuditRun(FinancialModel):
    id: UUID
    status: Literal["RUNNING", "COMPLETED", "FAILED"]
    started_at: datetime
    completed_at: datetime | None = None
    total_checks: int
    passed_checks: int
    failed_checks: int
    not_applicable_checks: int
    pass_rate: Decimal | None = None
    summary: dict[str, object] = Field(default_factory=dict)
    error_message: str | None = None
    checks: list[FinancialAuditCheckResult] = Field(default_factory=list)


class FinancialAuditRunsResponse(FinancialModel):
    runs: list[FinancialAuditRun]


class FinancialAuditRunCreateRequest(FinancialModel):
    idempotency_key: UUID


class FinancialScanLineItem(FinancialModel):
    description: Annotated[str | None, StringConstraints(max_length=500)] = None
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=3)
    unit_rate: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    tax_amount: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    total: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)


class FinancialScanResult(FinancialModel):
    vendor_name: Annotated[str | None, StringConstraints(max_length=240)] = None
    bill_number: Annotated[str | None, StringConstraints(max_length=120)] = None
    bill_date: date | None = None
    due_date: date | None = None
    currency: Literal["INR", "USD", "EUR"] | None = None
    line_items: list[FinancialScanLineItem] = Field(default_factory=list, max_length=100)
    subtotal: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    tax_amount: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    total: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)

    @model_validator(mode="after")
    def validate_scan_date_order(self):
        if self.bill_date and self.due_date and self.due_date < self.bill_date:
            raise ValueError("due_date must not be before bill_date")
        return self


class FinancialScanRecord(FinancialModel):
    id: UUID
    original_filename: str
    content_type: str
    file_size: int
    status: Literal["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "CONFIRMED"]
    progress: int
    retryable: bool
    result: FinancialScanResult = Field(default_factory=FinancialScanResult)
    reviewed_result: FinancialScanResult | None = None
    confidence: dict[str, float] = Field(default_factory=dict)
    extracted_text: str | None = None
    error_code: str | None = None
    retry_count: int
    confirmed_bill_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    processed_at: datetime | None = None


class FinancialScanListResponse(FinancialModel):
    scans: list[FinancialScanRecord] = Field(default_factory=list)


class FinancialScanReviewRequest(FinancialModel):
    result: FinancialScanResult


class FinancialVendorFields(FinancialModel):
    vendor_name: Annotated[str, StringConstraints(min_length=1, max_length=240)]
    contact_email: Annotated[str | None, StringConstraints(max_length=254)] = None
    contact_phone: Annotated[str | None, StringConstraints(max_length=40)] = None
    address: Annotated[str | None, StringConstraints(max_length=1000)] = None
    tax_identifier: Annotated[str | None, StringConstraints(max_length=64)] = None

    @field_validator("vendor_name")
    @classmethod
    def normalize_vendor_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("vendor_name must not be blank")
        return normalized

    @field_validator("contact_email", "contact_phone", "address", "tax_identifier")
    @classmethod
    def normalize_vendor_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None


class FinancialVendorCreateRequest(FinancialVendorFields):
    pass


class FinancialVendorUpdateRequest(FinancialVendorFields):
    is_active: bool


class FinancialVendorBillLinkRequest(FinancialModel):
    vendor_id: UUID


class FinancialVendorBillRecord(FinancialModel):
    id: UUID
    scan_id: UUID
    vendor_id: UUID | None = None
    vendor_name: str | None = None
    bill_number: str | None = None
    bill_date: date | None = None
    due_date: date | None = None
    currency: Currency | None = None
    total: Decimal | None = None
    confirmed_at: datetime


class FinancialVendorCurrencyTotal(FinancialModel):
    currency: Currency
    total: Decimal


class FinancialVendorResponse(FinancialVendorFields):
    id: UUID
    normalized_name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    bill_count: int = 0
    bill_totals_by_currency: list[FinancialVendorCurrencyTotal] = Field(default_factory=list)
    bills: list[FinancialVendorBillRecord] = Field(default_factory=list)


class FinancialVendorListResponse(FinancialModel):
    vendors: list[FinancialVendorResponse]
    total_count: int
    active_count: int
    inactive_count: int


class FinancialVendorBillResponse(FinancialModel):
    id: UUID
    scan_id: UUID
    vendor_id: UUID | None = None
    vendor_name: str | None = None
    bill_number: str | None = None
    bill_date: date | None = None
    due_date: date | None = None
    currency: Currency | None = None
    line_items: list[dict[str, object]] = Field(default_factory=list)
    subtotal: Decimal | None = None
    tax_amount: Decimal | None = None
    total: Decimal | None = None
    confirmed_at: datetime


class FinancialAgentConversationCreateResponse(FinancialModel):
    id: UUID
    status: Literal["ACTIVE"]
    revision: int
    created_at: datetime
    updated_at: datetime


class FinancialAgentConversationListResponse(FinancialModel):
    conversations: list[FinancialAgentConversationCreateResponse]
    page: int
    page_size: int
    has_more: bool


class FinancialAgentMessage(FinancialModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime


class FinancialAgentHistoryResponse(FinancialModel):
    messages: list[FinancialAgentMessage]
    page_size: int
    has_more: bool
    next_cursor: str | None = None


class FinancialAgentMessageRequest(FinancialModel):
    message: Annotated[str, StringConstraints(min_length=1, max_length=4000)]
    expected_revision: int = Field(ge=0)

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message must not be blank")
        return normalized


class FinancialAgentTurnResponse(FinancialModel):
    conversation: FinancialAgentConversationCreateResponse
    assistant_message: str
    messages: list[FinancialAgentMessage]
