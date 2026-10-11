"use client";

import React, { FormEvent, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Truck,
  X,
} from "lucide-react";
import {
  FulfillmentDraft,
  emptyFulfillmentDraft,
  localDateString,
  useSupplier,
} from "@/context/SupplierContext";
import {
  ProcurementPurchaseOrder,
  PurchaseOrderFulfillmentStatus,
} from "@/lib/procurement-api";

export default function SupplierOrdersPage() {
  const {
    company,
    purchaseOrders,
    purchaseOrdersLoading,
    purchaseOrdersLoaded,
    purchaseOrdersError,
    purchaseOrdersSuccess,
    purchaseOrderBusyId,
    setPurchaseOrdersError,
    refreshPurchaseOrders,
    respondToPurchaseOrder,
    updatePurchaseOrderFulfillment,
  } = useSupplier();

  const [fulfillmentOrderId, setFulfillmentOrderId] = useState("");
  const [fulfillmentDraft, setFulfillmentDraft] =
    useState<FulfillmentDraft | null>(null);

  const historicalStatuses = ["REJECTED", "CANCELLED", "DELIVERED"];
  const activeOrders = purchaseOrders.filter(
    (order) => !historicalStatuses.includes(order.status),
  );

  const fulfillmentStatusesFor = (
    status: ProcurementPurchaseOrder["status"],
  ): PurchaseOrderFulfillmentStatus[] => {
    if (status === "ACCEPTED" || status === "PREPARING") {
      return ["PREPARING", "DISPATCHED"];
    }
    if (status === "DISPATCHED") {
      return ["DISPATCHED", "PARTIALLY_DELIVERED", "DELIVERED"];
    }
    if (status === "PARTIALLY_DELIVERED") {
      return ["PARTIALLY_DELIVERED", "DELIVERED"];
    }
    return [];
  };

  const handleUpdateFulfillment = async (
    event: FormEvent<HTMLFormElement>,
    order: ProcurementPurchaseOrder,
  ) => {
    event.preventDefault();
    if (!fulfillmentDraft) return;
    const success = await updatePurchaseOrderFulfillment(
      order,
      fulfillmentDraft,
    );
    if (success) {
      setFulfillmentOrderId("");
      setFulfillmentDraft(null);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Truck size={19} className="text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-bold">Purchase orders & fulfilment</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
            Orders addressed to {company?.name || "this supplier company"}. An
            issued order can be accepted or rejected by your company. Accepted
            orders can be updated with dispatch and delivery progress.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshPurchaseOrders()}
          disabled={purchaseOrdersLoading}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <RefreshCw
            size={14}
            className={purchaseOrdersLoading ? "animate-spin" : ""}
          />{" "}
          Refresh orders
        </button>
      </div>

      {purchaseOrdersError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
        >
          {purchaseOrdersError}
        </div>
      )}

      {purchaseOrdersSuccess && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          {purchaseOrdersSuccess}
        </div>
      )}

      {purchaseOrdersLoading ? (
        <div
          role="status"
          className="flex items-center gap-2 py-8 text-sm text-slate-500"
        >
          <Loader2 size={16} className="animate-spin text-blue-600" /> Loading
          purchase orders…
        </div>
      ) : purchaseOrdersLoaded && activeOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
          No active purchase orders are available for this company. Completed or
          closed orders are in{" "}
          <a
            href="/supplier/history"
            className="font-semibold text-blue-600 underline dark:text-blue-400"
          >
            Order History
          </a>
          .
        </div>
      ) : purchaseOrdersLoaded ? (
        <ul className="space-y-4">
          {activeOrders.map((order) => (
            <li
              key={order.id}
              className="rounded-xl border border-slate-200 p-4 dark:border-slate-700 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {order.order_reference} · {order.item_name}
                  </p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {order.quantity} {order.unit} · {order.currency}{" "}
                    {order.unit_price} / {order.offered_unit}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Your quotation covered {order.quantity_offered}{" "}
                    {order.offered_unit}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    [
                      "ACCEPTED",
                      "PARTIALLY_DELIVERED",
                      "DELIVERED",
                    ].includes(order.status)
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : ["PREPARING", "DISPATCHED"].includes(order.status)
                        ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                        : order.status === "ISSUED"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {order.status}
                </span>
              </div>

              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Delivery location
                  </dt>
                  <dd className="mt-1">{order.delivery_location}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Lead time
                  </dt>
                  <dd className="mt-1">
                    {order.estimated_delivery_lead_time_days} days
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Quotation valid until
                  </dt>
                  <dd className="mt-1">{order.quotation_valid_until}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Created
                  </dt>
                  <dd className="mt-1">
                    {new Date(order.created_at).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Ordered quantity
                  </dt>
                  <dd className="mt-1">
                    {order.quantity} {order.unit}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Fulfillment progress
                  </dt>
                  <dd className="mt-1">
                    {order.dispatched_quantity} {order.fulfillment_unit}{" "}
                    dispatched · {order.delivered_quantity}{" "}
                    {order.fulfillment_unit} delivered
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Estimated delivery
                  </dt>
                  <dd className="mt-1">
                    {order.estimated_delivery_date || "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Latest tracking
                  </dt>
                  <dd className="mt-1 break-words">
                    {order.carrier ? `${order.carrier} · ` : ""}
                    {order.tracking_reference || "Not provided"}
                  </dd>
                </div>
                {order.delivery_date && (
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">
                      Last delivery date
                    </dt>
                    <dd className="mt-1">{order.delivery_date}</dd>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold text-slate-500">
                    Delivery terms
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap">
                    {order.delivery_terms}
                  </dd>
                </div>
                {order.supplier_notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold text-slate-500">
                      Your quotation notes
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap">
                      {order.supplier_notes}
                    </dd>
                  </div>
                )}
                {order.delivery_notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold text-slate-500">
                      Latest delivery notes
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap">
                      {order.delivery_notes}
                    </dd>
                  </div>
                )}
              </dl>

              {/* Fulfillment Events Timeline */}
              <details className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Fulfillment history ({order.fulfillment_events.length})
                </summary>
                {order.fulfillment_events.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">
                    No fulfillment updates have been recorded yet.
                  </p>
                ) : (
                  <ol className="mt-3 space-y-3">
                    {order.fulfillment_events.map((event) => (
                      <li
                        key={event.id}
                        className="border-l-2 border-purple-200 pl-3 dark:border-purple-900"
                      >
                        <p className="font-semibold text-xs sm:text-sm">
                          {event.status.replaceAll("_", " ")} ·{" "}
                          {new Date(event.created_at).toLocaleString()}
                        </p>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                          +{event.dispatched_quantity} {event.unit} dispatched ·
                          +{event.delivered_quantity} {event.unit} delivered
                        </p>
                        {(event.dispatch_date ||
                          event.carrier ||
                          event.tracking_reference) && (
                          <p className="mt-1 text-xs text-slate-500">
                            {event.dispatch_date || ""}
                            {event.carrier ? ` · ${event.carrier}` : ""}
                            {event.tracking_reference
                              ? ` · ${event.tracking_reference}`
                              : ""}
                          </p>
                        )}
                        {event.estimated_delivery_date && (
                          <p className="mt-1 text-xs text-slate-500">
                            Estimated delivery {event.estimated_delivery_date}
                          </p>
                        )}
                        {event.delivery_date && (
                          <p className="mt-1 text-xs text-slate-500">
                            Delivered {event.delivery_date}
                          </p>
                        )}
                        {event.delivery_notes && (
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">
                            {event.delivery_notes}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </details>

              {/* Accept / Reject actions for ISSUED orders */}
              {order.status === "ISSUED" && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <button
                    type="button"
                    disabled={Boolean(purchaseOrderBusyId)}
                    onClick={() => void respondToPurchaseOrder(order, "ACCEPTED")}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
                  >
                    {purchaseOrderBusyId === order.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    Accept order
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(purchaseOrderBusyId)}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Reject ${order.order_reference}? This decision cannot be reversed.`,
                        )
                      ) {
                        void respondToPurchaseOrder(order, "REJECTED");
                      }
                    }}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  >
                    <X size={14} /> Reject order
                  </button>
                </div>
              )}

              {/* Fulfillment update form */}
              {fulfillmentStatusesFor(order.status).length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                  {fulfillmentOrderId !== order.id ? (
                    <button
                      type="button"
                      disabled={Boolean(purchaseOrderBusyId)}
                      onClick={() => {
                        setFulfillmentOrderId(order.id);
                        setFulfillmentDraft(emptyFulfillmentDraft(order));
                        setPurchaseOrdersError("");
                      }}
                      className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-purple-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60"
                    >
                      <Truck size={14} /> Update fulfillment
                    </button>
                  ) : (
                    fulfillmentDraft && (
                      <form
                        className="space-y-3"
                        onSubmit={(e) => void handleUpdateFulfillment(e, order)}
                      >
                        <h3 className="font-semibold text-sm sm:text-base">
                          Record fulfillment progress
                        </h3>
                        <fieldset
                          disabled={Boolean(purchaseOrderBusyId)}
                          className="grid gap-3 sm:grid-cols-2"
                        >
                          <label className="text-sm font-medium">
                            Delivery status
                            <select
                              required
                              value={fulfillmentDraft.status}
                              onChange={(e) =>
                                setFulfillmentDraft({
                                  ...fulfillmentDraft,
                                  status: e.target
                                    .value as PurchaseOrderFulfillmentStatus,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-950"
                            >
                              {fulfillmentStatusesFor(order.status).map(
                                (status) => (
                                  <option key={status} value={status}>
                                    {status.replaceAll("_", " ")}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                          <label className="text-sm font-medium">
                            Estimated delivery date
                            <input
                              type="date"
                              min={localDateString()}
                              value={
                                fulfillmentDraft.estimated_delivery_date || ""
                              }
                              onChange={(e) =>
                                setFulfillmentDraft({
                                  ...fulfillmentDraft,
                                  estimated_delivery_date: e.target.value,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-950"
                            />
                            <span className="mt-1 block text-xs font-normal text-slate-500">
                              Forecast date only. A past saved estimate is
                              retained if left blank.
                            </span>
                          </label>
                          <label className="text-sm font-medium">
                            Additional dispatched quantity ({order.unit})
                            <input
                              type="number"
                              min={
                                fulfillmentDraft.status === "DISPATCHED"
                                  ? "0.0001"
                                  : "0"
                              }
                              max={
                                fulfillmentDraft.status === "PREPARING"
                                  ? "0"
                                  : undefined
                              }
                              step="any"
                              required={
                                fulfillmentDraft.status === "DISPATCHED"
                              }
                              value={fulfillmentDraft.dispatched_quantity}
                              onChange={(e) =>
                                setFulfillmentDraft({
                                  ...fulfillmentDraft,
                                  dispatched_quantity: e.target.value,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-950"
                            />
                          </label>
                          <label className="text-sm font-medium">
                            Dispatch date
                            <input
                              type="date"
                              max={localDateString()}
                              required={Boolean(
                                fulfillmentDraft.dispatched_quantity &&
                                  Number(
                                    fulfillmentDraft.dispatched_quantity,
                                  ) > 0,
                              )}
                              value={fulfillmentDraft.dispatch_date || ""}
                              onChange={(e) =>
                                setFulfillmentDraft({
                                  ...fulfillmentDraft,
                                  dispatch_date: e.target.value,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-950"
                            />
                            <span className="mt-1 block text-xs font-normal text-slate-500">
                              Actual dispatch date; cannot be in the future.
                            </span>
                          </label>
                          <label className="text-sm font-medium">
                            Carrier / transporter
                            <input
                              maxLength={200}
                              value={fulfillmentDraft.carrier || ""}
                              onChange={(e) =>
                                setFulfillmentDraft({
                                  ...fulfillmentDraft,
                                  carrier: e.target.value,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-950"
                            />
                          </label>
                          <label className="text-sm font-medium">
                            Tracking / reference number
                            <input
                              maxLength={200}
                              value={fulfillmentDraft.tracking_reference || ""}
                              onChange={(e) =>
                                setFulfillmentDraft({
                                  ...fulfillmentDraft,
                                  tracking_reference: e.target.value,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-950"
                            />
                          </label>
                          <label className="text-sm font-medium">
                            Additional delivered quantity ({order.unit})
                            <input
                              type="number"
                              min={
                                fulfillmentDraft.status ===
                                  "PARTIALLY_DELIVERED" ||
                                fulfillmentDraft.status === "DELIVERED"
                                  ? "0.0001"
                                  : "0"
                              }
                              max={
                                fulfillmentDraft.status === "PREPARING"
                                  ? "0"
                                  : undefined
                              }
                              step="any"
                              required={
                                fulfillmentDraft.status ===
                                  "PARTIALLY_DELIVERED" ||
                                fulfillmentDraft.status === "DELIVERED"
                              }
                              value={fulfillmentDraft.delivered_quantity}
                              onChange={(e) =>
                                setFulfillmentDraft({
                                  ...fulfillmentDraft,
                                  delivered_quantity: e.target.value,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-950"
                            />
                          </label>
                          <label className="text-sm font-medium">
                            Delivery date
                            <input
                              type="date"
                              max={localDateString()}
                              required={Boolean(
                                fulfillmentDraft.delivered_quantity &&
                                  Number(
                                    fulfillmentDraft.delivered_quantity,
                                  ) > 0,
                              )}
                              value={fulfillmentDraft.delivery_date || ""}
                              onChange={(e) =>
                                setFulfillmentDraft({
                                  ...fulfillmentDraft,
                                  delivery_date: e.target.value,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-950"
                            />
                            <span className="mt-1 block text-xs font-normal text-slate-500">
                              Actual delivery date; cannot be in the future.
                            </span>
                          </label>
                          <label className="text-sm font-medium sm:col-span-2">
                            Delivery notes
                            <textarea
                              maxLength={2000}
                              rows={3}
                              value={fulfillmentDraft.delivery_notes || ""}
                              onChange={(e) =>
                                setFulfillmentDraft({
                                  ...fulfillmentDraft,
                                  delivery_notes: e.target.value,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-950"
                            />
                          </label>
                        </fieldset>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="submit"
                            disabled={Boolean(purchaseOrderBusyId)}
                            className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-purple-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60"
                          >
                            {purchaseOrderBusyId === order.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={14} />
                            )}{" "}
                            Save fulfillment update
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(purchaseOrderBusyId)}
                            onClick={() => {
                              setFulfillmentOrderId("");
                              setFulfillmentDraft(null);
                            }}
                            className="min-h-9 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold dark:border-slate-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
