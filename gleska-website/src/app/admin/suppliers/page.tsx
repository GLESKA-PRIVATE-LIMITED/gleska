"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, ExternalLink, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import AdminShell from "@/components/admin/AdminShell";

type VerificationStatus =
  | "NOT_SUBMITTED"
  | "PENDING_REVIEW"
  | "VERIFIED"
  | "REJECTED"
  | "SUSPENDED";

interface QueueItem {
  id: string;
  name: string;
  verification_status: VerificationStatus;
  verification_submitted_at: string | null;
  created_at: string;
}

interface VerificationDocument {
  id: string;
  document_type: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
}

interface VerificationEvent {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  previous_status: VerificationStatus | null;
  new_status: VerificationStatus;
  reason: string | null;
  created_at: string;
}

interface SupplierDetail {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  operational_status: string;
  verification_status: VerificationStatus;
  verification_submitted_at: string | null;
  verification_reviewed_at: string | null;
  verification_reviewed_by: string | null;
  verification_reason: string | null;
  created_at: string;
  registered_name: string | null;
  registration_number: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  registered_address: string | null;
  documents: VerificationDocument[];
  events: VerificationEvent[];
}

const verificationStatuses: VerificationStatus[] = [
  "PENDING_REVIEW",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
  "NOT_SUBMITTED",
];

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function AdminSuppliersPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [filter, setFilter] = useState<VerificationStatus>("PENDING_REVIEW");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get<QueueItem[]>("/api/v1/admin/suppliers/verification", {
        params: { verification_status: filter },
      });
      setQueue(response.data);
      setSelectedId((current) =>
        response.data.some((item) => item.id === current)
          ? current
          : response.data[0]?.id || "",
      );
      return response.data;
    } catch {
      setError("Unable to load supplier verification records.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadDetail = useCallback(async (companyId: string) => {
    if (!companyId) {
      setDetail(null);
      return;
    }
    try {
      const response = await apiClient.get<SupplierDetail>(
        `/api/v1/admin/suppliers/${companyId}/verification`,
      );
      setDetail(response.data);
      setReason("");
    } catch {
      setDetail(null);
      setError("Unable to load supplier verification details.");
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/admin/login");
    else if (!isLoading && user && user.role !== "ADMIN") router.replace("/");
  }, [isLoading, router, user]);

  useEffect(() => {
    if (user?.role === "ADMIN") void loadQueue();
  }, [loadQueue, user]);

  useEffect(() => {
    if (user?.role === "ADMIN") void loadDetail(selectedId);
  }, [loadDetail, selectedId, user]);

  const review = async (action: "approve" | "reject" | "suspend" | "reinstate") => {
    if (!detail) return;
    if (action !== "approve" && !reason.trim()) {
      setError("A reason is required for rejection, suspension, and reinstatement.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiClient.post(
        `/api/v1/admin/suppliers/${detail.id}/verification/${action}`,
        { reason: reason.trim() || null },
      );
      const refreshedQueue = await loadQueue();
      const nextId = refreshedQueue.some((item) => item.id === detail.id)
        ? detail.id
        : refreshedQueue[0]?.id || "";
      setSelectedId(nextId);
      await loadDetail(nextId);
    } catch {
      setError("The supplier verification decision could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const openDocument = async (documentId: string) => {
    if (!detail) return;
    setError("");
    try {
      const response = await apiClient.get<{ url: string }>(
        `/api/v1/admin/suppliers/${detail.id}/documents/${documentId}/url`,
      );
      window.open(response.data.url, "_blank", "noopener,noreferrer");
    } catch {
      setError("Unable to create a private document link.");
    }
  };

  if (isLoading || !user || user.role !== "ADMIN") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  return (
    <AdminShell name={user.name} email={user.email} onLogout={() => void logout()}>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Procurement</p>
            <h1 className="mt-1 text-2xl font-bold">Supplier verification review</h1>
            <p className="mt-1 text-sm text-slate-600">
              Review private company details and submitted evidence before changing verification status.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadQueue()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </header>

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.5fr)]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="mb-2 block text-sm font-semibold" htmlFor="supplier-status-filter">
              Verification status
            </label>
            <select
              id="supplier-status-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as VerificationStatus)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {verificationStatuses.map((value) => (
                <option key={value} value={value}>{value.replaceAll("_", " ")}</option>
              ))}
            </select>
            <div className="mt-4 space-y-2">
              {loading && <p className="flex items-center gap-2 p-3 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} /> Loading…</p>}
              {!loading && queue.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full rounded-xl border p-3 text-left ${selectedId === item.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}
                >
                  <span className="block font-semibold">{item.name}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    Submitted {formatDate(item.verification_submitted_at)}
                  </span>
                </button>
              ))}
              {!loading && queue.length === 0 && <p className="p-3 text-sm text-slate-500">No suppliers in this status.</p>}
            </div>
          </section>

          {!detail ? (
            <section className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
              Select a supplier to review.
            </section>
          ) : (
            <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Company</p>
                  <h2 className="mt-1 text-xl font-bold">{detail.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Verification: <strong>{detail.verification_status.replaceAll("_", " ")}</strong>
                    {" · "}Operational: {detail.operational_status}
                  </p>
                </div>
                <BadgeCheck className="text-indigo-600" size={24} />
              </header>

              <dl className="grid gap-x-6 gap-y-3 border-y border-slate-200 py-4 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-slate-500">Registered name</dt><dd>{detail.registered_name || "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Registration number</dt><dd>{detail.registration_number || "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Contact email</dt><dd>{detail.contact_email || "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Contact phone</dt><dd>{detail.contact_phone || "—"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Registered address</dt><dd>{detail.registered_address || "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Submitted</dt><dd>{formatDate(detail.verification_submitted_at)}</dd></div>
                <div><dt className="text-xs text-slate-500">Last reviewed</dt><dd>{formatDate(detail.verification_reviewed_at)}</dd></div>
                {detail.verification_reason && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-slate-500">Latest review feedback</dt>
                    <dd>{detail.verification_reason}</dd>
                  </div>
                )}
              </dl>

              <div>
                <h3 className="font-semibold">Submitted documents</h3>
                <div className="mt-2 space-y-2">
                  {detail.documents.map((document) => (
                    <div key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{document.original_filename}</p>
                        <p className="text-xs text-slate-500">
                          {document.document_type.replaceAll("_", " ")} · {Math.ceil(document.file_size_bytes / 1024)} KB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void openDocument(document.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold"
                      >
                        <ExternalLink size={14} /> View private file
                      </button>
                    </div>
                  ))}
                  {detail.documents.length === 0 && <p className="text-sm text-slate-500">No documents submitted.</p>}
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <label className="mb-2 block text-sm font-semibold" htmlFor="review-reason">
                  Review reason or feedback
                </label>
                <textarea
                  id="review-reason"
                  rows={3}
                  maxLength={2000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"
                  placeholder="Required for rejection, suspension, and reinstatement."
                />
                {detail.verification_status === "PENDING_REVIEW" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={saving} onClick={() => void review("approve")} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve</button>
                    <button type="button" disabled={saving || !reason.trim()} onClick={() => void review("reject")} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Reject</button>
                  </div>
                )}
                {detail.verification_status === "VERIFIED" && (
                  <button type="button" disabled={saving || !reason.trim()} onClick={() => void review("suspend")} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    <ShieldAlert size={16} /> Suspend verification
                  </button>
                )}
                {detail.verification_status === "SUSPENDED" && (
                  <button type="button" disabled={saving || !reason.trim()} onClick={() => void review("reinstate")} className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Reinstate verification</button>
                )}
                {saving && <Loader2 className="mt-3 animate-spin text-slate-600" size={18} />}
              </div>

              <div>
                <h3 className="font-semibold">Review history</h3>
                <ol className="mt-2 space-y-3">
                  {detail.events.map((event) => (
                    <li key={event.id} className="border-l-2 border-slate-200 pl-3 text-sm">
                      <p className="font-medium">
                        {event.previous_status || "NEW"} → {event.new_status}
                        <span className="ml-2 text-xs font-normal text-slate-500">{formatDate(event.created_at)}</span>
                      </p>
                      <p className="text-xs text-slate-500">{event.actor_name || "System"}</p>
                      {event.reason && <p className="mt-1 text-slate-600">{event.reason}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          )}
        </div>
      </main>
    </AdminShell>
  );
}
