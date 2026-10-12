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
  isActiveSupplierPurchaseOrderStatus,
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

  const activeOrders = purchaseOrders.filter(
    (order) => isActiveSupplierPurchaseOrderStatus(order.status),
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
            <Truck size={17} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Purchase Orders</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Accept, reject, and update fulfillment progress
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refreshPurchaseOrders()}
          disabled={purchaseOrdersLoading}
          className="inline-flex min-h-8 self-start sm:self-auto items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RefreshCw size={13} className={purchaseOrdersLoading ? "animate-spin" : ""} />
          Refresh
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
          No purchase orders currently need a supplier response or fulfillment.
          Delivered, rejected, and cancelled orders are in{" "}
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
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                    Order Reference
                  </span>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white break-words">
                    {order.order_reference} · <span className="font-semibold text-slate-700 dark:text-slate-300">{order.item_name}</span>
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 break-words">
                    Agreed: {order.quantity} {order.unit} @ {order.currency} {order.unit_price} / {order.offered_unit}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold uppercase truncate max-w-[9rem] ${
                    [
                      "ACCEPTED",
                      "PARTIALLY_DELIVERED",
                      "DELIVERED",
                    ].includes(order.status)
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : ["PREPARING", "DISPATCHED"].includes(order.status)
                        ? "bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300"
                        : order.status === "ISSUED"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {order.status}
                </span>
              </div>

              {/* Scannable Metric Cards */}
              <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/40">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Lead Time
                  </span>
                  <span className="mt-0.5 block text-sm font-bold text-slate-900 dark:text-white">
                    {order.estimated_delivery_lead_time_days} days
                  </span>
                </div>
                <div className="rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/40">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Dispatched
                  </span>
                  <span className="mt-0.5 block text-sm font-bold text-slate-900 dark:text-white">
                    {order.dispatched_quantity} {order.fulfillment_unit}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/40">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Delivered
                  </span>
                  <span className="mt-0.5 block text-sm font-bold text-slate-900 dark:text-white">
                    {order.delivered_quantity} {order.fulfillment_unit}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/40">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Est. Delivery
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {order.estimated_delivery_date || "Pending"}
                  </span>
                </div>
              </div>

              {/* Logistics & Tracking Meta */}
              <div className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                <div>
                  <span className="font-semibold text-slate-500">Destination: </span>
                  <span className="text-slate-700 dark:text-slate-300">{order.delivery_location}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-500">Tracking: </span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {order.carrier ? `${order.carrier} · ` : ""}
                    {order.tracking_reference || "No tracking recorded"}
                  </span>
                </div>
                {order.delivery_terms && (
                  <div className="sm:col-span-2">
                    <span className="font-semibold text-slate-500">Terms: </span>
                    <span className="text-slate-700 dark:text-slate-300">{order.delivery_terms}</span>
                  </div>
                )}
                {order.supplier_notes && (
                  <div className="sm:col-span-2">
                    <span className="font-semibold text-slate-500">Quotation Notes: </span>
                    <span className="text-slate-700 dark:text-slate-300">{order.supplier_notes}</span>
                  </div>
                )}
              </div>

              {/* Fulfillment Events Timeline */}
              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                <details className="group">
                  <summary className="flex items-center justify-between cursor-pointer list-none select-none text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
                    <span className="flex items-center gap-2">
                      <span>Fulfillment History</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {order.fulfillment_events.length} {order.fulfillment_events.length === 1 ? "update" : "updates"}
                      </span>
                    </span>
                    <span className="text-xs text-blue-600 group-open:rotate-180 transition-transform dark:text-blue-400">
                      ▼
                    </span>
                  </summary>

                  {order.fulfillment_events.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                      No fulfillment updates have been recorded yet.
                    </p>
                  ) : (
                    <div className="relative mt-4 pl-4 sm:pl-6 before:absolute before:left-2 sm:before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800 space-y-3.5">
                      {order.fulfillment_events.map((event) => {
                        const isDelivered = event.status === "DELIVERED";
                        const isDispatched = event.status === "DISPATCHED";
                        const isPreparing = event.status === "PREPARING";

                        return (
                          <div
                            key={event.id}
                            className="relative flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3 shadow-2xs dark:border-slate-800/80 dark:bg-slate-900/60"
                          >
                            <span
                              className={`absolute -left-[23px] sm:-left-[31px] top-3 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ring-4 ring-white dark:ring-slate-900 ${
                                isDelivered
                                  ? "bg-emerald-600 text-white"
                                  : isDispatched
                                    ? "bg-blue-600 text-white"
                                    : isPreparing
                                      ? "bg-purple-600 text-white"
                                      : "bg-slate-400 text-white"
                              }`}
                            >
                              {isDelivered ? "✓" : isDispatched ? "➔" : "•"}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <span
                                  className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                    isDelivered
                                      ? "bg-emerald-100/70 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                      : isDispatched
                                        ? "bg-blue-100/70 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                                        : "bg-purple-100/70 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                                  }`}
                                >
                                  {event.status.replaceAll("_", " ")}
                                </span>
                                <time className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                                  {new Date(event.created_at).toLocaleString()}
                                </time>
                              </div>

                              <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-xs">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  +{event.dispatched_quantity} {event.unit} dispatched
                                </span>
                                <span className="text-slate-300 dark:text-slate-700">·</span>
                                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                  +{event.delivered_quantity} {event.unit} delivered
                                </span>
                              </div>

                              {(event.dispatch_date || event.carrier || event.tracking_reference || event.estimated_delivery_date || event.delivery_date) && (
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                  {event.carrier && <span>{event.carrier}</span>}
                                  {event.tracking_reference && <span> · Tracking #{event.tracking_reference}</span>}
                                  {event.dispatch_date && <span> · Dispatched {event.dispatch_date}</span>}
                                  {event.estimated_delivery_date && <span> · Est. {event.estimated_delivery_date}</span>}
                                  {event.delivery_date && <span> · Delivered {event.delivery_date}</span>}
                                </p>
                              )}

                              {event.delivery_notes && (
                                <div className="mt-1.5 rounded-lg bg-white/80 p-2 text-xs text-slate-600 dark:bg-slate-800/80 dark:text-slate-300 border border-slate-100 dark:border-slate-800">
                                  <span className="font-semibold text-slate-700 dark:text-slate-200">Note: </span>
                                  {event.delivery_notes}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </details>
              </div>

              {/* Accept / Reject actions for ISSUED orders */}
              {order.status === "ISSUED" && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <button
                    type="button"
                    disabled={Boolean(purchaseOrderBusyId)}
                    onClick={() => void respondToPurchaseOrder(order, "ACCEPTED")}
                    className="w-full sm:w-auto inline-flex min-h-9 items-center gap-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
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
                    className="w-full sm:w-auto inline-flex min-h-9 items-center gap-2 rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
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
                        className="space-y-3 overflow-y-auto max-h-[90vh]"
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
                            className="w-full sm:w-auto inline-flex min-h-9 items-center gap-2 rounded-lg bg-purple-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60"
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
                            className="w-full sm:w-auto min-h-9 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold dark:border-slate-700"
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
