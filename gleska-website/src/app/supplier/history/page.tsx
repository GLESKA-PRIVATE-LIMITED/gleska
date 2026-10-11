"use client";

import React from "react";
import { Clock3, Loader2, RefreshCw } from "lucide-react";
import { useSupplier } from "@/context/SupplierContext";

export default function SupplierHistoryPage() {
  const {
    company,
    purchaseOrders,
    purchaseOrdersLoading,
    purchaseOrdersLoaded,
    purchaseOrdersError,
    refreshPurchaseOrders,
  } = useSupplier();

  const historicalStatuses = ["REJECTED", "CANCELLED", "DELIVERED"];
  const historyOrders = purchaseOrders.filter((order) =>
    historicalStatuses.includes(order.status),
  );

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Clock3 size={19} className="text-purple-600 dark:text-purple-400" />
            <h2 className="text-lg font-bold">Order history</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
            Completed, rejected, or cancelled orders addressed to{" "}
            {company?.name || "this supplier company"}. The API returns up to
            100 records; older history may not be included.
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
          Refresh history
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
          No completed, rejected, or cancelled orders are in the available
          history. Active purchase orders are in{" "}
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
                    order.status === "DELIVERED"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : order.status === "REJECTED"
                        ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
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
                    Created
                  </dt>
                  <dd className="mt-1">
                    {new Date(order.created_at).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">
                    Final fulfillment
                  </dt>
                  <dd className="mt-1">
                    {order.dispatched_quantity} {order.fulfillment_unit}{" "}
                    dispatched · {order.delivered_quantity}{" "}
                    {order.fulfillment_unit} delivered
                  </dd>
                </div>
                {order.delivery_date && (
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">
                      Completed delivery date
                    </dt>
                    <dd className="mt-1">{order.delivery_date}</dd>
                  </div>
                )}
                {order.carrier && (
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">
                      Carrier / Tracking
                    </dt>
                    <dd className="mt-1">
                      {order.carrier}
                      {order.tracking_reference
                        ? ` · ${order.tracking_reference}`
                        : ""}
                    </dd>
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
                {order.delivery_notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold text-slate-500">
                      Final delivery notes
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap">
                      {order.delivery_notes}
                    </dd>
                  </div>
                )}
              </dl>

              {/* Fulfilment Event Timeline */}
              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Fulfillment activity history ({order.fulfillment_events.length})
                </h4>
                {order.fulfillment_events.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    No fulfillment event updates were recorded for this order.
                  </p>
                ) : (
                  <ol className="mt-3 space-y-3">
                    {order.fulfillment_events.map((event) => (
                      <li
                        key={event.id}
                        className="border-l-2 border-slate-300 pl-3 dark:border-slate-700"
                      >
                        <p className="font-semibold text-xs sm:text-sm">
                          {event.status.replaceAll("_", " ")} ·{" "}
                          {new Date(event.created_at).toLocaleString()}
                        </p>
                        <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
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
                        {event.delivery_date && (
                          <p className="mt-1 text-xs text-slate-500">
                            Delivered date: {event.delivery_date}
                          </p>
                        )}
                        {event.delivery_notes && (
                          <p className="mt-1 whitespace-pre-wrap text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                            {event.delivery_notes}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
