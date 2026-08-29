"""Employer subscription payment endpoints."""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.security import require_employer
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.payment import PaymentStatusResponse, SubscriptionOrderResponse
from app.services.cashfree_payment_service import CashfreePaymentError, CashfreePaymentService

router = APIRouter(prefix="/payments", tags=["payments"])
logger = logging.getLogger(__name__)


def _as_dict(data: Any) -> dict[str, Any]:
    if isinstance(data, list):
        return data[0] if data else {}
    return data or {}


def _payment_status(cashfree_status: str) -> str:
    normalized = cashfree_status.upper()
    if normalized == "PAID":
        return "SUCCESS"
    if normalized in {"USER_DROPPED", "CANCELLED", "CANCELED"}:
        return "CANCELLED"
    if normalized == "EXPIRED":
        return "EXPIRED"
    if normalized in {"FAILED", "FAILURE"}:
        return "FAILED"
    return "PENDING"


def _validate_paid_order(cashfree_order: dict[str, Any], order_id: str, transaction: dict[str, Any]) -> None:
    if cashfree_order.get("order_id") != order_id or not cashfree_order.get("cf_order_id"):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PAYMENT_PROVIDER_ORDER_INVALID")
    if _payment_status(str(cashfree_order.get("order_status"))) != "SUCCESS":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PAYMENT_NOT_SUCCESSFUL")
    try:
        provider_amount = Decimal(str(cashfree_order.get("order_amount")))
        local_amount = Decimal(str(transaction.get("amount")))
    except (InvalidOperation, TypeError):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PAYMENT_PROVIDER_AMOUNT_INVALID") from None
    if provider_amount != local_amount or str(cashfree_order.get("order_currency", "")).upper() != str(transaction.get("currency", "")).upper():
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="PAYMENT_PROVIDER_DETAILS_MISMATCH")


def _validate_success_webhook(order: dict[str, Any], payment: dict[str, Any], transaction: dict[str, Any]) -> None:
    if not order.get("order_id") or not order.get("cf_order_id") or payment.get("payment_status") != "SUCCESS":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PAYMENT_WEBHOOK_DETAILS_INVALID")
    if order.get("order_id") != transaction.get("order_id"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PAYMENT_PROVIDER_ORDER_INVALID")
    try:
        provider_amount = Decimal(str(order.get("order_amount")))
        local_amount = Decimal(str(transaction.get("amount")))
    except (InvalidOperation, TypeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PAYMENT_WEBHOOK_DETAILS_INVALID") from None
    if provider_amount != local_amount or str(order.get("order_currency", "")).upper() != str(transaction.get("currency", "")).upper():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PAYMENT_PROVIDER_DETAILS_MISMATCH")


async def _employer(user: UserResponse, fields: str = "id") -> dict[str, Any]:
    response = supabase.table("employer_profiles").select(fields).eq("user_id", user.id).single().execute()
    employer = _as_dict(response.data)
    if not employer.get("id"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employer profile not found")
    return employer


@router.post("/create-subscription-order", response_model=SubscriptionOrderResponse)
async def create_subscription_order(user: UserResponse = Depends(require_employer)):
    employer = await _employer(user)
    
    # Mark any stale PENDING payments as EXPIRED before creating a fresh order.
    # This ensures renewal always creates a valid, current payment session.
    pending = (
        supabase.table("payment_transactions")
        .select("id")
        .eq("employer_id", employer["id"])
        .eq("status", "PENDING")
        .execute()
    )
    if pending.data:
        for stale in pending.data:
            supabase.table("payment_transactions").update({"status": "EXPIRED"}).eq("id", stale["id"]).execute()

    try:
        order = await CashfreePaymentService.create_subscription_order(
            str(employer["id"]),
            user.mobile,
            str(user.email) if user.email else None,
        )
    except CashfreePaymentError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    transaction_timestamp = datetime.now(timezone.utc)
    transaction = supabase.table("payment_transactions").insert({
        "id": str(uuid.uuid4()),
        "order_id": order["order_id"],
        "cf_order_id": order.get("cf_order_id"),
        "employer_id": employer["id"],
        "amount": CashfreePaymentService.PAYMENT_AMOUNT,
        "currency": CashfreePaymentService.PAYMENT_CURRENCY,
        "status": "PENDING",
        "payment_session_id": order["payment_session_id"],
        "created_at": transaction_timestamp.isoformat(),
        "updated_at": transaction_timestamp.isoformat(),
    }).execute()
    if not transaction.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PAYMENT_TRANSACTION_CREATE_FAILED")
    return SubscriptionOrderResponse(**order)


@router.post("/verify/{order_id}", response_model=PaymentStatusResponse)
async def verify_payment(order_id: str, user: UserResponse = Depends(require_employer)):
    employer = await _employer(user, "id, subscription_valid_until")
    transaction_response = (
        supabase.table("payment_transactions")
        .select("*")
        .eq("order_id", order_id)
        .eq("employer_id", employer["id"])
        .maybe_single()
        .execute()
    )
    transaction = _as_dict(transaction_response.data)
    if not transaction:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PAYMENT_ORDER_NOT_FOUND")
    if transaction.get("status") == "SUCCESS":
        return PaymentStatusResponse(
            order_id=order_id,
            status="SUCCESS",
            subscription_valid_until=employer.get("subscription_valid_until"),
        )

    try:
        cashfree_order = await CashfreePaymentService.get_order_status(order_id)
    except CashfreePaymentError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    payment_status = _payment_status(str(cashfree_order["order_status"]))
    cf_order_id = cashfree_order.get("cf_order_id")
    if payment_status == "SUCCESS":
        _validate_paid_order(cashfree_order, order_id, transaction)
        result = supabase.rpc("process_subscription_payment_success", {
            "p_order_id": order_id,
            "p_cf_order_id": cf_order_id,
        }).execute()
        rpc_result = result.data[0] if isinstance(result.data, list) and result.data else result.data
        rpc_value = rpc_result if isinstance(rpc_result, str) else next(iter(rpc_result.values()), None) if isinstance(rpc_result, dict) else None
        if rpc_value not in {"SUCCESS", "ALREADY_SUCCESS"}:
            if rpc_value == "INVALID_STATE":
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="PAYMENT_STATE_INVALID")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PAYMENT_SUCCESS_PROCESSING_FAILED")
        employer = await _employer(user, "id, subscription_valid_until")
    else:
        supabase.table("payment_transactions").update({
            "status": payment_status,
            "cf_order_id": cf_order_id,
        }).eq("order_id", order_id).eq("employer_id", employer["id"]).eq("status", "PENDING").execute()

    return PaymentStatusResponse(
        order_id=order_id,
        status=payment_status,
        subscription_valid_until=employer.get("subscription_valid_until"),
    )


@router.post("/webhook")
async def cashfree_webhook(request: Request):
    signature = request.headers.get("x-webhook-signature")
    timestamp = request.headers.get("x-webhook-timestamp")
    raw_body = await request.body()
    if not signature or not timestamp or not CashfreePaymentService.verify_webhook_signature(signature, timestamp, raw_body):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook signature")
    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook payload") from exc

    event_type = str(payload.get("type") or "").upper()
    order = ((payload.get("data") or {}).get("order") or {})
    order_id = order.get("order_id")
    if not order_id:
        return {"status": "IGNORED"}

    transaction_response = (
        supabase.table("payment_transactions")
        .select("order_id, employer_id, status, amount, currency")
        .eq("order_id", order_id)
        .maybe_single()
        .execute()
    )
    transaction = _as_dict(transaction_response.data)
    if not transaction:
        return {"status": "ACKNOWLEDGED"}

    if event_type == "PAYMENT_SUCCESS_WEBHOOK":
        _validate_success_webhook(order, (payload.get("data") or {}).get("payment") or {}, transaction)
        if transaction.get("status") == "SUCCESS":
            supabase.table("payment_transactions").update({"raw_webhook_payload": payload}).eq("order_id", order_id).execute()
            return {"status": "OK"}
        if transaction.get("status") != "PENDING":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="PAYMENT_STATE_INVALID")
        result = supabase.rpc("process_subscription_payment_success", {
            "p_order_id": order_id,
            "p_cf_order_id": order.get("cf_order_id"),
        }).execute()
        rpc_result = result.data[0] if isinstance(result.data, list) and result.data else result.data
        rpc_value = rpc_result if isinstance(rpc_result, str) else next(iter(rpc_result.values()), None) if isinstance(rpc_result, dict) else None
        if rpc_value not in {"SUCCESS", "ALREADY_SUCCESS"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="PAYMENT_STATE_INVALID")
        supabase.table("payment_transactions").update({"raw_webhook_payload": payload}).eq("order_id", order_id).execute()
    elif event_type:
        mapped_status = {
            "PAYMENT_FAILED_WEBHOOK": "FAILED",
            "PAYMENT_CANCELLED_WEBHOOK": "CANCELLED",
            "PAYMENT_CANCELED_WEBHOOK": "CANCELLED",
            "PAYMENT_EXPIRED_WEBHOOK": "EXPIRED",
        }.get(event_type)
        if mapped_status is None:
            logger.info("Ignoring unknown Cashfree payment webhook event: event_type=%s", event_type)
            return {"status": "IGNORED"}
        if mapped_status != "SUCCESS":
            supabase.table("payment_transactions").update({
                "status": mapped_status,
                "raw_webhook_payload": payload,
            }).eq("order_id", order_id).eq("status", "PENDING").execute()

    logger.info("Cashfree payment webhook processed: order_id=%s event_type=%s", order_id, event_type)
    return {"status": "OK"}
