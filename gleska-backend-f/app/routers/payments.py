"""Employer subscription payment endpoints."""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.security import get_current_user, require_employer, require_worker
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.payment import (
    IndividualCommissionOrderRequest,
    IndividualSubscriptionOrderRequest,
    PaymentHistoryItem,
    PaymentStatusResponse,
    SubscriptionOrderResponse,
)
from app.services.cashfree_payment_service import CashfreePaymentError, CashfreePaymentService

router = APIRouter(prefix="/payments", tags=["payments"])
logger = logging.getLogger(__name__)


def _history_validity_status(category: str | None, valid_until: str | None) -> str:
    if category in ("WORKER_SUBSCRIPTION", "BUSINESS_SUBSCRIPTION"):
        if not valid_until:
            return "UNKNOWN"
        try:
            expiry = datetime.fromisoformat(valid_until.replace("Z", "+00:00"))
            return "ACTIVE" if expiry > datetime.now(timezone.utc) else "EXPIRED"
        except (TypeError, ValueError):
            return "UNKNOWN"
    if category in ("INDIVIDUAL_COMMISSION", "LEGACY_PAYMENT"):
        return "N/A"
    return "UNKNOWN"


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


@router.post("/employer/create-commission-order", response_model=SubscriptionOrderResponse)
async def create_employer_commission_order(
    request: IndividualCommissionOrderRequest,
    user: UserResponse = Depends(require_employer),
):
    employer = await _employer(user, "id, employer_type")
    if employer.get("employer_type") != "INDIVIDUAL":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="COMMISSION_ONLY_FOR_INDIVIDUAL_EMPLOYERS",
        )

    # 1. Authoritative check: Job exists and is owned by caller
    job_resp = (
        supabase.table("jobs")
        .select("id, employer_id, title")
        .eq("id", request.job_id)
        .eq("employer_id", employer["id"])
        .maybe_single()
        .execute()
    )
    job = job_resp.data or {}
    if not job.get("id"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="JOB_NOT_FOUND")

    # 2. Authoritative check: Worker exists
    worker_resp = (
        supabase.table("worker_profiles")
        .select("id")
        .eq("id", request.worker_profile_id)
        .maybe_single()
        .execute()
    )
    if not (worker_resp.data or {}).get("id"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="WORKER_NOT_FOUND")

    # 3. Authoritative check: Match exists for this job and worker
    match_resp = (
        supabase.table("job_matches")
        .select("id, status")
        .eq("job_id", request.job_id)
        .eq("worker_profile_id", request.worker_profile_id)
        .maybe_single()
        .execute()
    )
    match_data = match_resp.data or {}
    if not match_data.get("id"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MATCH_NOT_FOUND")
    if match_data.get("status") == "ACCEPTED":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="WORKER_ALREADY_DISPATCHED")

    # 4. Authoritative check: Commission not already paid for this exact worker on this job
    existing_success = (
        supabase.table("payment_transactions")
        .select("id, job_id, raw_webhook_payload")
        .eq("employer_id", employer["id"])
        .eq("worker_profile_id", request.worker_profile_id)
        .eq("status", "SUCCESS")
        .execute()
    )
    for row in (existing_success.data or []):
        p_job_id = row.get("job_id") or (row.get("raw_webhook_payload") or {}).get("job_id")
        if str(p_job_id) == str(request.job_id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="COMMISSION_ALREADY_PAID")

    # 5. Strict server-side amount: ₹30 per actual worker
    amount = 30.0

    # 6. Mark any stale PENDING transactions for this employer + worker as EXPIRED
    pending = (
        supabase.table("payment_transactions")
        .select("id")
        .eq("employer_id", employer["id"])
        .eq("worker_profile_id", request.worker_profile_id)
        .eq("status", "PENDING")
        .execute()
    )
    for stale in (pending.data or []):
        supabase.table("payment_transactions").update({"status": "EXPIRED"}).eq("id", stale["id"]).execute()

    try:
        order = await CashfreePaymentService.create_subscription_order(
            str(employer["id"]),
            user.mobile,
            str(user.email) if user.email else None,
            amount=amount,
            order_note=f"Worker Commission: Job {request.job_id}",
            return_path="/employer/dashboard",
        )
    except CashfreePaymentError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    timestamp = datetime.now(timezone.utc)
    insert_payload = {
        "id": str(uuid.uuid4()),
        "order_id": order["order_id"],
        "cf_order_id": order.get("cf_order_id"),
        "employer_id": employer["id"],
        "worker_profile_id": request.worker_profile_id,
        "payment_category": "INDIVIDUAL_COMMISSION",
        "amount": amount,
        "employee_count": 1,
        "currency": CashfreePaymentService.PAYMENT_CURRENCY,
        "status": "PENDING",
        "payment_session_id": order["payment_session_id"],
        "raw_webhook_payload": {
            "job_id": str(request.job_id),
            "worker_profile_id": str(request.worker_profile_id),
            "payment_type": "INDIVIDUAL_COMMISSION",
        },
        "created_at": timestamp.isoformat(),
        "updated_at": timestamp.isoformat(),
    }
    try:
        transaction = supabase.table("payment_transactions").insert(dict(insert_payload, job_id=str(request.job_id))).execute()
    except Exception:
        transaction = supabase.table("payment_transactions").insert(insert_payload).execute()

    if not transaction.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PAYMENT_TRANSACTION_CREATE_FAILED")
    return SubscriptionOrderResponse(**order)


@router.post("/create-subscription-order", response_model=SubscriptionOrderResponse)
async def create_subscription_order(
    user: UserResponse = Depends(require_employer),
    request: dict[str, Any] | None = None,
):
    employer = await _employer(user, "id, employer_type")
    is_individual = employer.get("employer_type") == "INDIVIDUAL"
    if is_individual:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="INDIVIDUAL_EMPLOYERS_USE_COMMISSION_PER_WORKER: Individual employers do not use monthly subscriptions. You pay ₹30 per actual worker dispatched from the job matches page.",
        )
    amount = CashfreePaymentService.PAYMENT_AMOUNT
    
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
        "payment_category": "BUSINESS_SUBSCRIPTION",
        "amount": amount,
        "employee_count": None,
        "currency": CashfreePaymentService.PAYMENT_CURRENCY,
        "status": "PENDING",
        "payment_session_id": order["payment_session_id"],
        "raw_webhook_payload": {
            "payment_type": "BUSINESS_SUBSCRIPTION",
        },
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


async def _worker(user: UserResponse, fields: str = "id") -> dict[str, Any]:
    response = supabase.table("worker_profiles").select(fields).eq("user_id", user.id).single().execute()
    worker = _as_dict(response.data)
    if not worker.get("id"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker profile not found")
    return worker


@router.get("/history", response_model=list[PaymentHistoryItem])
async def get_payment_history(
    user: UserResponse = Depends(get_current_user),
):
    if user.role not in {"WORKER", "EMPLOYER"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Payment history is unavailable for this role")
    if user.role == "WORKER":
        owner = await _worker(user, "id")
        query = (
            supabase.table("payment_transactions")
            .select("id, order_id, payment_category, amount, currency, status, created_at, updated_at, payment_success_at, subscription_valid_from, subscription_valid_until, worker_profile_id")
            .eq("worker_profile_id", owner["id"])
        )
    else:
        owner = await _employer(user, "id")
        query = (
            supabase.table("payment_transactions")
            .select("id, order_id, payment_category, amount, currency, status, created_at, updated_at, payment_success_at, subscription_valid_from, subscription_valid_until, job_id, worker_profile_id")
            .eq("employer_id", owner["id"])
        )

    rows = query.order("created_at", desc=True).execute().data or []
    job_ids = [str(row["job_id"]) for row in rows if row.get("job_id")]
    worker_ids = [str(row["worker_profile_id"]) for row in rows if row.get("worker_profile_id")]
    jobs = {}
    workers = {}
    if job_ids:
        jobs = {str(row["id"]): row.get("title") for row in (supabase.table("jobs").select("id, title").in_("id", job_ids).execute().data or [])}
    if worker_ids:
        worker_rows = supabase.table("worker_profiles").select("id, users(name)").in_("id", worker_ids).execute().data or []
        for row in worker_rows:
            user_row = row.get("users") or {}
            if isinstance(user_row, list):
                user_row = user_row[0] if user_row else {}
            workers[str(row["id"])] = user_row.get("name")

    history = []
    for row in rows:
        category = str(row.get("payment_category") or "UNKNOWN").upper()
        if category not in {"WORKER_SUBSCRIPTION", "BUSINESS_SUBSCRIPTION", "INDIVIDUAL_COMMISSION", "LEGACY_PAYMENT", "UNKNOWN"}:
            category = "UNKNOWN"
        history.append(PaymentHistoryItem(
            id=str(row["id"]),
            order_id=row.get("order_id") or "",
            payment_category=category,
            amount=float(row.get("amount") or 0),
            currency=row.get("currency") or "INR",
            status=row.get("status") or "",
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
            payment_success_at=row.get("payment_success_at"),
            subscription_valid_from=row.get("subscription_valid_from"),
            subscription_valid_until=row.get("subscription_valid_until"),
            validity_status=_history_validity_status(category, row.get("subscription_valid_until")),
            job_id=str(row["job_id"]) if row.get("job_id") else None,
            job_title=jobs.get(str(row["job_id"])) if row.get("job_id") else None,
            worker_profile_id=str(row["worker_profile_id"]) if row.get("worker_profile_id") else None,
            worker_name=workers.get(str(row["worker_profile_id"])) if row.get("worker_profile_id") else None,
        ))
    return history


@router.post("/worker/create-subscription-order", response_model=SubscriptionOrderResponse)
async def create_worker_subscription_order(user: UserResponse = Depends(require_worker)):
    worker = await _worker(user)
    pending = (
        supabase.table("payment_transactions")
        .select("id")
        .eq("worker_profile_id", worker["id"])
        .eq("status", "PENDING")
        .execute()
    )
    for stale in pending.data or []:
        supabase.table("payment_transactions").update({"status": "EXPIRED"}).eq("id", stale["id"]).execute()

    try:
        order = await CashfreePaymentService.create_subscription_order(
            str(worker["id"]), user.mobile, str(user.email) if user.email else None,
            amount=200.0, order_note="Worker Monthly Subscription", return_path="/worker/subscription",
        )
    except CashfreePaymentError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    timestamp = datetime.now(timezone.utc)
    transaction = supabase.table("payment_transactions").insert({
        "id": str(uuid.uuid4()), "order_id": order["order_id"], "cf_order_id": order.get("cf_order_id"),
        "worker_profile_id": worker["id"], "payment_category": "WORKER_SUBSCRIPTION", "amount": 200.0, "currency": "INR", "status": "PENDING",
        "payment_session_id": order["payment_session_id"], "created_at": timestamp.isoformat(), "updated_at": timestamp.isoformat(),
    }).execute()
    if not transaction.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="PAYMENT_TRANSACTION_CREATE_FAILED")
    return SubscriptionOrderResponse(**order)


@router.post("/worker/verify/{order_id}", response_model=PaymentStatusResponse)
async def verify_worker_payment(order_id: str, user: UserResponse = Depends(require_worker)):
    worker = await _worker(user, "id, subscription_valid_until")
    response = (
        supabase.table("payment_transactions").select("*").eq("order_id", order_id)
        .eq("worker_profile_id", worker["id"]).maybe_single().execute()
    )
    transaction = _as_dict(response.data)
    if not transaction:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PAYMENT_ORDER_NOT_FOUND")
    if transaction.get("status") == "SUCCESS":
        return PaymentStatusResponse(order_id=order_id, status="SUCCESS", subscription_valid_until=worker.get("subscription_valid_until"))
    try:
        cashfree_order = await CashfreePaymentService.get_order_status(order_id)
    except CashfreePaymentError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    payment_status = _payment_status(str(cashfree_order["order_status"]))
    cf_order_id = cashfree_order.get("cf_order_id")
    if payment_status == "SUCCESS":
        _validate_paid_order(cashfree_order, order_id, transaction)
        result = supabase.rpc("process_subscription_payment_success", {"p_order_id": order_id, "p_cf_order_id": cf_order_id}).execute()
        rpc_result = result.data[0] if isinstance(result.data, list) and result.data else result.data
        rpc_value = rpc_result if isinstance(rpc_result, str) else next(iter(rpc_result.values()), None) if isinstance(rpc_result, dict) else None
        if rpc_value not in {"SUCCESS", "ALREADY_SUCCESS"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="PAYMENT_STATE_INVALID")
        worker = await _worker(user, "id, subscription_valid_until")
    else:
        supabase.table("payment_transactions").update({"status": payment_status, "cf_order_id": cf_order_id}).eq("order_id", order_id).eq("worker_profile_id", worker["id"]).eq("status", "PENDING").execute()
    return PaymentStatusResponse(order_id=order_id, status=payment_status, subscription_valid_until=worker.get("subscription_valid_until"))


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
        .select("order_id, employer_id, worker_profile_id, status, amount, currency")
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
