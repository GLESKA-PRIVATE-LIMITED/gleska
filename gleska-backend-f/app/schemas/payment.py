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


class PaymentStatusResponse(BaseModel):
    order_id: str
    status: str
    subscription_valid_until: datetime | None = None