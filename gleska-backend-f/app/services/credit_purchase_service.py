"""AI credit purchases through Cashfree (ADR 0007, increment 2; migration 105).

Credits are added only by the `billing_complete_purchase` SQL function, and only after Cashfree
confirms the payment — either through the signed webhook or a server-side order lookup. Both
paths may arrive for the same order; the SQL function makes the second one a no-op. The rupee
amount is fixed by the server when the order is created and re-checked against Cashfree.
"""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any

from app.ai_gateway.errors import AIBillingError
from app.core.config import settings
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.billing import CreditPurchase, CreditPurchaseOrder, CreditReceipt
from app.services.billing_service import BillingNotFound, BillingService, _employer_identities, _first, _now, _rows
from app.services.cashfree_payment_service import CashfreePaymentError, CashfreePaymentService

logger = logging.getLogger(__name__)

ORDER_PREFIX = "cred_"
PURCHASE_COLUMNS = "order_id, credits, amount_inr, currency, status, receipt_number, payment_method, paid_at, created_at"
RECEIPT_NOTE = "Payment receipt for prepaid AI credits. No GST charged: the seller is not GST-registered."
_CLOSED_CASHFREE_STATUSES = {"EXPIRED", "TERMINATED", "TERMINATION_REQUESTED"}


class PurchaseError(Exception):
    """Domain error; `str(exc)` is an UPPER_SNAKE code for the router."""


def is_credit_order(order_id: Any) -> bool:
    return isinstance(order_id, str) and order_id.startswith(ORDER_PREFIX)


def settings_row() -> dict[str, Any]:
    row = _first(
        supabase.table("billing_settings").select("id, credit_value_inr")
        .lte("effective_from", _now()).order("effective_from", desc=True).limit(1).execute()
    )
    if not row:
        raise AIBillingError("BILLING_UNAVAILABLE")
    return row


def _order_for(account_id: str, order_id: str) -> dict[str, Any]:
    row = _first(
        supabase.table("credit_purchase_orders").select("*")
        .eq("account_id", account_id).eq("order_id", order_id).limit(1).execute()
    )
    if not row:
        raise BillingNotFound("PURCHASE_NOT_FOUND")
    return row


def _amount(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise PurchaseError("PAYMENT_PROVIDER_AMOUNT_INVALID") from None


def _complete(order: dict[str, Any], paid_amount: Decimal, currency: str, *, cf_order_id: Any = None,
              cf_payment_id: Any = None, payment_method: Any = None) -> dict[str, Any]:
    """Credit the order exactly once. Amount/currency are re-checked in SQL as well."""
    if paid_amount != Decimal(str(order["amount_inr"])) or str(currency or "").upper() != order["currency"]:
        logger.error("Credit purchase amount mismatch: order_id=%s", order["order_id"])
        raise PurchaseError("PAYMENT_PROVIDER_DETAILS_MISMATCH")
    try:
        result = supabase.rpc("billing_complete_purchase", {
            "p_order_id": order["order_id"],
            "p_paid_amount": str(paid_amount),
            "p_currency": str(currency).upper(),
            "p_cf_order_id": str(cf_order_id) if cf_order_id else None,
            "p_cf_payment_id": str(cf_payment_id) if cf_payment_id else None,
            "p_payment_method": str(payment_method)[:40] if payment_method else None,
        }).execute()
    except Exception as exc:
        text = str(exc)
        for code in ("PURCHASE_AMOUNT_MISMATCH", "PURCHASE_STATE_INVALID", "PURCHASE_NOT_FOUND"):
            if code in text:
                logger.error("Credit purchase not completed: order_id=%s code=%s", order["order_id"], code)
                raise PurchaseError(code) from exc
        raise
    logger.info("Credit purchase completed: order_id=%s", order["order_id"])
    return result.data or {}


def _payment_method(payment: dict[str, Any]) -> str | None:
    group = payment.get("payment_group")
    if group:
        return str(group)
    method = payment.get("payment_method")
    return next(iter(method.keys()), None) if isinstance(method, dict) and method else None


class CreditPurchaseService:
    @staticmethod
    async def create(user: UserResponse, credits: int) -> CreditPurchaseOrder:
        account_id = BillingService.account_for(user)
        account = _first(supabase.table("billing_accounts").select("status").eq("id", account_id).limit(1).execute())
        if not account or account.get("status") != "active":
            raise AIBillingError("BILLING_ACCOUNT_SUSPENDED")
        config = settings_row()
        credit_value = Decimal(str(config["credit_value_inr"]))
        amount = (Decimal(credits) * credit_value).quantize(Decimal("0.01"))
        order_id = f"{ORDER_PREFIX}{uuid.uuid4().hex[:24]}"
        supabase.table("credit_purchase_orders").insert({
            "order_id": order_id,
            "account_id": account_id,
            "user_id": user.id,
            "credits": str(credits),
            "credit_value_inr": str(credit_value),
            "settings_id": config.get("id"),
            "amount_inr": str(amount),
            "currency": "INR",
            "status": "PENDING",
        }).execute()
        try:
            order = await CashfreePaymentService.create_subscription_order(
                account_id,
                user.mobile,
                str(user.email) if user.email else None,
                # Cashfree's API takes a JSON number; the value is exact to the paisa.
                amount=float(amount),
                order_note=f"{credits} GO LESKA AI credits",
                return_path="/employer/billing",
                order_id=order_id,
            )
        except CashfreePaymentError as exc:
            logger.error("Credit purchase order creation failed: order_id=%s", order_id)
            supabase.table("credit_purchase_orders").update(
                {"status": "FAILED", "last_payment_status": "ORDER_CREATE_FAILED", "updated_at": _now()}
            ).eq("order_id", order_id).eq("status", "PENDING").execute()
            raise PurchaseError("PAYMENT_PROVIDER_UNAVAILABLE") from exc
        if order.get("cf_order_id"):
            supabase.table("credit_purchase_orders").update(
                {"cf_order_id": str(order["cf_order_id"]), "updated_at": _now()}
            ).eq("order_id", order_id).execute()
        return CreditPurchaseOrder(
            order_id=order_id, payment_session_id=order["payment_session_id"], credits=Decimal(credits), amount_inr=amount,
        )

    @staticmethod
    def list(account_id: str, limit: int = 50) -> list[CreditPurchase]:
        rows = _rows(
            supabase.table("credit_purchase_orders").select(PURCHASE_COLUMNS)
            .eq("account_id", account_id).order("created_at", desc=True).limit(limit).execute()
        )
        return [CreditPurchase(**row) for row in rows]

    @staticmethod
    async def verify(account_id: str, order_id: str) -> CreditPurchase:
        """Return-page check: ask Cashfree directly instead of waiting for the webhook."""
        order = _order_for(account_id, order_id)
        if order["status"] == "PENDING":
            try:
                provider = await CashfreePaymentService.get_order_status(order_id)
            except CashfreePaymentError as exc:
                raise PurchaseError("PAYMENT_PROVIDER_UNAVAILABLE") from exc
            if provider.get("order_id") != order_id:
                raise PurchaseError("PAYMENT_PROVIDER_ORDER_INVALID")
            provider_status = str(provider.get("order_status") or "").upper()
            if provider_status == "PAID":
                _complete(order, _amount(provider.get("order_amount")), str(provider.get("order_currency") or ""),
                          cf_order_id=provider.get("cf_order_id"))
            elif provider_status in _CLOSED_CASHFREE_STATUSES:
                supabase.table("credit_purchase_orders").update(
                    {"status": "EXPIRED", "last_payment_status": provider_status, "updated_at": _now()}
                ).eq("order_id", order_id).eq("status", "PENDING").execute()
            order = _order_for(account_id, order_id)
        return CreditPurchase(**{k: order.get(k) for k in CreditPurchase.model_fields})

    @staticmethod
    def handle_webhook(event_type: str, order: dict[str, Any], payment: dict[str, Any]) -> dict[str, str]:
        """Signed Cashfree webhook for a `cred_` order (signature already verified by the router)."""
        order_id = order.get("order_id")
        row = _first(supabase.table("credit_purchase_orders").select("*").eq("order_id", order_id).limit(1).execute())
        if not row:
            return {"status": "ACKNOWLEDGED"}
        if event_type == "PAYMENT_SUCCESS_WEBHOOK":
            if payment.get("payment_status") != "SUCCESS" or not order.get("cf_order_id"):
                raise PurchaseError("PAYMENT_WEBHOOK_DETAILS_INVALID")
            _complete(row, _amount(order.get("order_amount")), str(order.get("order_currency") or ""),
                      cf_order_id=order.get("cf_order_id"), cf_payment_id=payment.get("cf_payment_id"),
                      payment_method=_payment_method(payment))
            return {"status": "OK"}
        if event_type in {"PAYMENT_FAILED_WEBHOOK", "PAYMENT_USER_DROPPED_WEBHOOK",
                          "PAYMENT_CANCELLED_WEBHOOK", "PAYMENT_CANCELED_WEBHOOK"}:
            # The buyer can retry within the same Cashfree order, so the order stays PENDING.
            supabase.table("credit_purchase_orders").update(
                {"last_payment_status": str(payment.get("payment_status") or event_type)[:40], "updated_at": _now()}
            ).eq("order_id", order_id).eq("status", "PENDING").execute()
            return {"status": "OK"}
        return {"status": "IGNORED"}

    @staticmethod
    def receipt(account_id: str, order_id: str) -> CreditReceipt:
        order = _order_for(account_id, order_id)
        if order["status"] != "PAID":
            raise BillingNotFound("RECEIPT_NOT_AVAILABLE")
        account = _first(supabase.table("billing_accounts").select("employer_id").eq("id", account_id).limit(1).execute()) or {}
        buyer_name = buyer_email = None
        if account.get("employer_id"):
            identity = _employer_identities([account["employer_id"]]).get(account["employer_id"], {})
            buyer_name, buyer_email = identity.get("employer_name"), identity.get("employer_email")
        return CreditReceipt(
            receipt_number=order["receipt_number"],
            order_id=order_id,
            seller_name=settings.BILLING_SELLER_NAME,
            buyer_name=buyer_name,
            buyer_email=buyer_email,
            credits=Decimal(str(order["credits"])),
            credit_value_inr=Decimal(str(order["credit_value_inr"])),
            amount_inr=Decimal(str(order["amount_inr"])),
            currency=order["currency"],
            payment_method=order.get("payment_method"),
            cf_payment_id=order.get("cf_payment_id"),
            paid_at=order["paid_at"],
            note=RECEIPT_NOTE,
        )

    @staticmethod
    def admin_list(limit: int = 200) -> list[dict[str, Any]]:
        rows = _rows(
            supabase.table("credit_purchase_orders")
            .select("order_id, account_id, credits, amount_inr, status, receipt_number, payment_method, "
                    "last_payment_status, paid_at, created_at")
            .order("created_at", desc=True).limit(limit).execute()
        )
        return rows
