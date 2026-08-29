"""Payment Gateway request and response contracts."""

from datetime import datetime
from pydantic import BaseModel


class SubscriptionOrderResponse(BaseModel):
    order_id: str
    cf_order_id: str | None = None
    payment_session_id: str


class PaymentStatusResponse(BaseModel):
    order_id: str
    status: str
    subscription_valid_until: datetime | None = None