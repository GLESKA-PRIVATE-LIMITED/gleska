"""Payment Gateway request and response contracts."""

from datetime import datetime
from pydantic import BaseModel
from pydantic import Field


class SubscriptionOrderResponse(BaseModel):
    order_id: str
    cf_order_id: str | None = None
    payment_session_id: str


class IndividualSubscriptionOrderRequest(BaseModel):
    employee_count: int = Field(..., ge=1)


class IndividualCommissionOrderRequest(BaseModel):
    job_id: str
    worker_profile_id: str


class PaymentStatusResponse(BaseModel):
    order_id: str
    status: str
    subscription_valid_until: datetime | None = None


class PaymentHistoryItem(BaseModel):
    id: str
    order_id: str
    payment_category: str
    amount: float
    currency: str
    status: str
    created_at: datetime
    updated_at: datetime | None = None
    payment_success_at: datetime | None = None
    subscription_valid_from: datetime | None = None
    subscription_valid_until: datetime | None = None
    validity_status: str
    job_id: str | None = None
    job_title: str | None = None
    worker_profile_id: str | None = None
    worker_name: str | None = None
