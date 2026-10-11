"use client";

import React, { FormEvent, useState } from "react";
import {
  Archive,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import {
  SupplierMaterialOffering,
  SupplierOfferingDraft,
  emptyOfferingDraft,
  useSupplier,
} from "@/context/SupplierContext";

export default function SupplierOfferingsPage() {
  const {
    company,
    canManageMembers,
    offerings,
    offeringsLoading,
    offeringsLoaded,
    offeringsError,
    offeringsSuccess,
    includeArchivedOfferings,
    setIncludeArchivedOfferings,
    refreshOfferings,
    saveOffering,
    archiveOffering,
  } = useSupplier();

  const [offeringDraft, setOfferingDraft] =
    useState<SupplierOfferingDraft>(emptyOfferingDraft);
  const [editingOfferingId, setEditingOfferingId] = useState("");
  const [offeringBusy, setOfferingBusy] = useState(false);

  const visibleOfferings = offerings.filter(
    (offering) => includeArchivedOfferings || !offering.archived_at,
  );

  const handleSaveOffering = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setOfferingBusy(true);
    const success = await saveOffering(
      offeringDraft,
      editingOfferingId || undefined,
    );
    if (success) {
      setOfferingDraft(emptyOfferingDraft);
      setEditingOfferingId("");
    }
    setOfferingBusy(false);
  };

  const handleEditOffering = (offering: SupplierMaterialOffering) => {
    setEditingOfferingId(offering.id);
    setOfferingDraft({
      name: offering.name,
      specification: offering.specification || "",
      unit: offering.unit,
      indicative_price: offering.indicative_price || "",
      currency_code: offering.currency_code || "",
      minimum_order_quantity: offering.minimum_order_quantity || "",
      is_available: offering.is_available,
      service_coverage: offering.service_coverage.join("\n"),
    });
  };

  const handleCancelEdit = () => {
    setEditingOfferingId("");
    setOfferingDraft(emptyOfferingDraft);
  };

  const handleArchive = async (offering: SupplierMaterialOffering) => {
    if (
      !window.confirm(
        `Archive "${offering.name}"? It will no longer be available for future discovery.`,
      )
    ) {
      return;
    }
    setOfferingBusy(true);
    const success = await archiveOffering(offering);
    if (success && editingOfferingId === offering.id) {
      setEditingOfferingId("");
      setOfferingDraft(emptyOfferingDraft);
    }
    setOfferingBusy(false);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Package size={19} className="text-purple-600 dark:text-purple-400" />
            <h2 className="text-lg font-bold">Material offerings</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
            Manage materials and service areas your company can provide. Buyers
            may see available, non-archived listings when your company is active
            and verified; catalogue discovery does not start a transaction.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canManageMembers && (
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeArchivedOfferings}
                onChange={(event) =>
                  setIncludeArchivedOfferings(event.target.checked)
                }
                className="rounded border-slate-300"
              />
              Show archived
            </label>
          )}
          <button
            type="button"
            onClick={() => void refreshOfferings()}
            disabled={offeringsLoading}
            className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <RefreshCw
              size={14}
              className={offeringsLoading ? "animate-spin" : ""}
            />{" "}
            Refresh
          </button>
        </div>
      </div>

      {offeringsError && (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
        >
          <span>{offeringsError}</span>
          <button
            type="button"
            onClick={() => void refreshOfferings()}
            disabled={offeringsLoading}
            className="font-semibold underline disabled:opacity-60"
          >
            Retry offerings
          </button>
        </div>
      )}

      {offeringsSuccess && (
        <div
          role="status"
          className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          {offeringsSuccess}
        </div>
      )}

      {/* Offering Form */}
      {canManageMembers && (
        <form
          onSubmit={handleSaveOffering}
          className="mt-5 space-y-4 border-t border-slate-200 pt-5 dark:border-slate-800"
        >
          <h3 className="font-semibold text-slate-900 dark:text-white">
            {editingOfferingId
              ? "Edit material offering"
              : "Add a material offering"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label>
              <span className="mb-1 block text-sm font-medium">
                Material name *
              </span>
              <input
                required
                minLength={2}
                maxLength={240}
                value={offeringDraft.name}
                onChange={(event) =>
                  setOfferingDraft({
                    ...offeringDraft,
                    name: event.target.value,
                  })
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium">Unit *</span>
              <input
                required
                maxLength={48}
                value={offeringDraft.unit}
                onChange={(event) =>
                  setOfferingDraft({
                    ...offeringDraft,
                    unit: event.target.value,
                  })
                }
                placeholder="e.g. MT, bags, pieces"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium">
                Minimum order quantity
              </span>
              <input
                type="number"
                min="0.0001"
                step="any"
                value={offeringDraft.minimum_order_quantity}
                onChange={(event) =>
                  setOfferingDraft({
                    ...offeringDraft,
                    minimum_order_quantity: event.target.value,
                  })
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium">
                Indicative price (optional)
              </span>
              <input
                type="number"
                min="0.0001"
                step="any"
                value={offeringDraft.indicative_price}
                onChange={(event) =>
                  setOfferingDraft({
                    ...offeringDraft,
                    indicative_price: event.target.value,
                  })
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium">
                Currency code {offeringDraft.indicative_price && "*"}
              </span>
              <input
                minLength={3}
                maxLength={3}
                required={Boolean(offeringDraft.indicative_price)}
                value={offeringDraft.currency_code}
                onChange={(event) =>
                  setOfferingDraft({
                    ...offeringDraft,
                    currency_code: event.target.value.toUpperCase(),
                  })
                }
                placeholder="e.g. INR"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm uppercase dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label className="flex items-center gap-2 self-end pb-3 text-sm font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={offeringDraft.is_available}
                onChange={(event) =>
                  setOfferingDraft({
                    ...offeringDraft,
                    is_available: event.target.checked,
                  })
                }
                className="rounded border-slate-300"
              />
              Currently available
            </label>
            <label className="sm:col-span-2 lg:col-span-3">
              <span className="mb-1 block text-sm font-medium">
                Specifications / grade
              </span>
              <textarea
                maxLength={2000}
                rows={2}
                value={offeringDraft.specification}
                onChange={(event) =>
                  setOfferingDraft({
                    ...offeringDraft,
                    specification: event.target.value,
                  })
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label className="sm:col-span-2 lg:col-span-3">
              <span className="mb-1 block text-sm font-medium">
                Service coverage areas (one per line)
              </span>
              <textarea
                rows={3}
                value={offeringDraft.service_coverage}
                onChange={(event) =>
                  setOfferingDraft({
                    ...offeringDraft,
                    service_coverage: event.target.value,
                  })
                }
                placeholder="Enter the cities, districts, or regions you serve."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={offeringBusy || company?.operational_status !== "ACTIVE"}
              className="inline-flex items-center gap-2 rounded-xl bg-purple-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-800 disabled:opacity-60"
            >
              {offeringBusy ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              {editingOfferingId ? "Save offering" : "Add offering"}
            </button>
            {editingOfferingId && (
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={offeringBusy}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold dark:border-slate-700 hover:bg-slate-50"
              >
                <X size={16} /> Cancel edit
              </button>
            )}
          </div>
        </form>
      )}

      {/* Offerings List */}
      <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
        {offeringsLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="animate-spin text-purple-600" size={16} />{" "}
            Loading offerings...
          </div>
        ) : offeringsLoaded && visibleOfferings.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            {offerings.length > 0
              ? "No active offerings. Turn on “Show archived” to view archived records."
              : "No material offerings have been added yet."}
          </p>
        ) : offeringsLoaded ? (
          <ul className="space-y-3">
            {visibleOfferings.map((offering) => (
              <li
                key={offering.id}
                className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900 dark:text-white">
                        {offering.name}
                      </h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          offering.archived_at
                            ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            : offering.is_available
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        }`}
                      >
                        {offering.archived_at
                          ? "Archived"
                          : offering.is_available
                            ? "Available"
                            : "Unavailable"}
                      </span>
                    </div>
                    {offering.specification && (
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {offering.specification}
                      </p>
                    )}
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      Unit: {offering.unit}
                      {offering.minimum_order_quantity &&
                        ` · Minimum order: ${offering.minimum_order_quantity} ${offering.unit}`}
                      {offering.indicative_price &&
                        ` · Indicative price: ${offering.currency_code} ${offering.indicative_price} / ${offering.unit}`}
                    </p>
                    {offering.service_coverage.length > 0 && (
                      <p className="mt-1 text-xs text-slate-500">
                        Coverage: {offering.service_coverage.join(", ")}
                      </p>
                    )}
                  </div>
                  {canManageMembers && !offering.archived_at && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={offeringBusy}
                        onClick={() => handleEditOffering(offering)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold dark:border-slate-700 hover:bg-slate-50"
                      >
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        disabled={offeringBusy}
                        onClick={() => void handleArchive(offering)}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:text-amber-200 hover:bg-amber-50"
                      >
                        <Archive size={13} /> Archive
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
