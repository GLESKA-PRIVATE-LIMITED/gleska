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


class FinancialSettings(FinancialModel):
    base_currency: Currency = "INR"
    tax_identifier: Annotated[str, StringConstraints(max_length=64)] = ""
    auto_reconcile_incoming_bills: bool = False

    @field_validator("tax_identifier", mode="before")
    @classmethod
    def normalize_tax_identifier(cls, value):
        if isinstance(value, str):
            return " ".join(value.split())
        return value


class FinancialSettingsUpdate(FinancialSettings):
    pass


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


class InvoiceListResponse(FinancialModel):
    invoices: list[InvoiceResponse]


class FinancialDashboardSummary(FinancialModel):
    total_invoiced: float
    pending_receivables: float | None
    active_invoices: int
    audits_passed: int | None
    audit_pass_rate: float | None
    active_vendors: int | None


class FinancialDashboardRecord(FinancialModel):
    id: str
    type: Literal["INVOICE", "TRANSACTION", "AUDIT", "VENDOR"]
    title: str
    entity: str
    reference: str
    amount: float | None
    status: str
    date: str
    category: str


class FinancialDashboardResponse(FinancialModel):
    summary: FinancialDashboardSummary
    records: list[FinancialDashboardRecord]


class FinancialAuditsResponse(FinancialModel):
    audits: list[dict] = Field(default_factory=list)


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
