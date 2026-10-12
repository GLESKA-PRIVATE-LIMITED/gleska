"use client";

import React from "react";
import { Clock3, Loader2, RefreshCw } from "lucide-react";
import { useSupplier } from "@/context/SupplierContext";
import { isHistoricalSupplierPurchaseOrderStatus } from "@/lib/procurement-api";

export default function SupplierHistoryPage() {
  const {
    company,
    purchaseOrders,
    purchaseOrdersLoading,
    purchaseOrdersLoaded,
    purchaseOrdersError,
    refreshPurchaseOrders,
  } = useSupplier();

  const historyOrders = purchaseOrders.filter((order) =>
    isHistoricalSupplierPurchaseOrderStatus(order.status),
  );

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400">
            <Clock3 size={17} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Order History</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Delivered, rejected, and cancelled purchase orders
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

      {purchaseOrdersLoading ? (
        <div
          role="status"
          className="flex items-center gap-2 py-8 text-sm text-slate-500"
        >
          <Loader2 size={16} className="animate-spin text-purple-600" /> Loading
          order history…
        </div>
      ) : purchaseOrdersLoaded && historyOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
          No delivered, rejected, or cancelled purchase orders are in the
          available history. Active purchase orders are in{" "}
          <a
            href="/supplier/orders"
            className="font-semibold text-purple-600 underline dark:text-purple-400"
          >
            Purchase Orders
          </a>
          .
        </div>
      ) : purchaseOrdersLoaded ? (
        <ul className="space-y-4">
          {historyOrders.map((order) => (
            <li
              key={order.id}
              className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                    Historical Order
                  </span>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white break-words">
                    {order.order_reference} · <span className="font-semibold text-slate-700 dark:text-slate-300">{order.item_name}</span>
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 break-words">
                    {order.quantity} {order.unit} @ {order.currency} {order.unit_price} / {order.offered_unit}
                  </p>
                </div>
                <span
                  className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold uppercase ${
                    order.status === "DELIVERED"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : order.status === "REJECTED"
                        ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {order.status}
                </span>
              </div>

              {/* Scannable Metric Cards */}
              <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/40">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Ordered quantity
                  </span>
                  <span className="mt-1.5 block text-sm font-bold text-slate-900 dark:text-white">
                    {order.quantity} {order.unit}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/40">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Recorded delivered quantity
                  </span>
                  <span className="mt-1.5 block text-sm font-bold text-slate-900 dark:text-white">
                    {order.delivered_quantity} {order.fulfillment_unit}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/40">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Recorded delivery date
                  </span>
                  <span className="mt-1.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {order.delivery_date || "—"}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/40">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Destination
                  </span>
                  <span className="mt-1.5 block text-sm font-medium text-slate-800 dark:text-slate-200 truncate" title={order.delivery_location}>
                    {order.delivery_location}
                  </span>
                </div>
              </div>

              {/* Logistics & Delivery Details */}
              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                  <span className="block font-bold uppercase tracking-wider text-[10px] text-slate-400 dark:text-slate-500">
                    Carrier & Tracking
                  </span>
                  <span className="mt-1 block font-medium text-slate-800 dark:text-slate-200">
                    {order.carrier ? (
                      <>
                        <span className="font-semibold text-slate-900 dark:text-white">{order.carrier}</span>
                        {order.tracking_reference && (
                          <span className="block text-slate-500 font-mono text-[11px] mt-0.5 dark:text-slate-400">
                            Ref: {order.tracking_reference}
                          </span>
                        )}
                      </>
                    ) : (
                      "No carrier assigned"
                    )}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                  <span className="block font-bold uppercase tracking-wider text-[10px] text-slate-400 dark:text-slate-500">
                    Delivery Terms
                  </span>
                  <span className="mt-1 block font-medium text-slate-800 dark:text-slate-200">
                    {order.delivery_terms || "Standard agreed terms"}
                  </span>
                </div>

                {order.delivery_notes && (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40 sm:col-span-2 lg:col-span-1">
                    <span className="block font-bold uppercase tracking-wider text-[10px] text-slate-400 dark:text-slate-500">
                      Delivery Note
                    </span>
                    <span className="mt-1 block font-medium text-slate-700 italic dark:text-slate-300 line-clamp-2" title={order.delivery_notes}>
                      “{order.delivery_notes}”
                    </span>
                  </div>
                )}
              </div>

              {/* Fulfilment Timeline & Activity */}
              <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
                <details className="group">
                  <summary className="flex items-center justify-between cursor-pointer list-none select-none text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
                    <span className="flex items-center gap-2">
                      <span>Fulfillment Activity Timeline</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {order.fulfillment_events.length} {order.fulfillment_events.length === 1 ? "update" : "updates"}
                      </span>
                    </span>
                    <span className="text-xs text-purple-600 group-open:rotate-180 transition-transform dark:text-purple-400">
                      ▼
                    </span>
                  </summary>

                  {order.fulfillment_events.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                      No fulfillment event updates were recorded for this order.
                    </p>
                  ) : (
                    <div className="relative mt-4 space-y-4 pl-5 before:absolute before:bottom-2 before:left-2 before:top-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800 sm:pl-7 sm:before:left-3">
                      {order.fulfillment_events.map((event) => {
                        const isDelivered = event.status === "DELIVERED";
                        const isDispatched = event.status === "DISPATCHED";
                        const isPreparing = event.status === "PREPARING";

                        return (
                          <div
                            key={event.id}
                            className="relative flex items-start gap-3.5 overflow-hidden rounded-xl border border-slate-100 bg-slate-50/50 p-3.5 shadow-2xs transition hover:bg-slate-50 dark:border-slate-800/80 dark:bg-slate-900/60 dark:hover:bg-slate-800/40"
                          >
                            {/* Status Node Icon */}
                            <span
                              className={`absolute -left-[18px] top-3.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-4 ring-white dark:ring-slate-900 sm:-left-[26px] ${
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

                              {/* Progress metrics */}
                              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  +{event.dispatched_quantity} {event.unit} dispatched
                                </span>
                                <span className="text-slate-300 dark:text-slate-700">·</span>
                                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                  +{event.delivered_quantity} {event.unit} delivered
                                </span>
                              </div>

                              {/* Carrier & Delivery meta */}
                              {(event.dispatch_date || event.carrier || event.tracking_reference || event.delivery_date) && (
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                  {event.carrier && <span>{event.carrier}</span>}
                                  {event.tracking_reference && <span> · Tracking #{event.tracking_reference}</span>}
                                  {event.dispatch_date && <span> · Dispatched {event.dispatch_date}</span>}
                                  {event.delivery_date && <span> · Delivered {event.delivery_date}</span>}
                                </p>
                              )}

                              {/* Notes */}
                              {event.delivery_notes && (
                                <div className="mt-2 rounded-lg bg-white/80 p-2 text-xs text-slate-600 dark:bg-slate-800/80 dark:text-slate-300 border border-slate-100 dark:border-slate-800">
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
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
