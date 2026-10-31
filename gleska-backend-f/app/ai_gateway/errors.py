from fastapi import HTTPException, status

# code -> HTTP status. Billing refusals happen before any provider call.
_STATUS = {
    "INSUFFICIENT_CREDITS": status.HTTP_402_PAYMENT_REQUIRED,
    "BILLING_ACCOUNT_SUSPENDED": status.HTTP_403_FORBIDDEN,
    "BILLING_ACCOUNT_REQUIRED": status.HTTP_403_FORBIDDEN,
    "AI_PRICING_NOT_CONFIGURED": status.HTTP_503_SERVICE_UNAVAILABLE,
    "AI_FX_RATE_NOT_CONFIGURED": status.HTTP_503_SERVICE_UNAVAILABLE,
    "BILLING_UNAVAILABLE": status.HTTP_503_SERVICE_UNAVAILABLE,
    "BILLING_CONTEXT_MISSING": status.HTTP_500_INTERNAL_SERVER_ERROR,
}


class AIBillingError(HTTPException):
    """The gateway refused or could not bill an AI request. Never caught-and-ignored by callers."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(status_code=_STATUS.get(code, status.HTTP_503_SERVICE_UNAVAILABLE), detail=code)
