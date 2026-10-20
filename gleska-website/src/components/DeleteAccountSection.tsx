"use client";

import React, { useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert, Trash2, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

interface DeleteAccountSectionProps {
  /** Optional custom title or description */
  className?: string;
  roleLabel?: string;
}

export default function DeleteAccountSection({
  className = "",
  roleLabel,
}: DeleteAccountSectionProps) {
  const { user, deleteAccount } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [reason, setReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const label = roleLabel || (user?.role === "WORKER" ? "Worker" : user?.role === "EMPLOYER" ? "Employer" : user?.role === "ADMIN" ? "Administrator" : "Account");
  const isConfirmed = confirmationInput.trim().toUpperCase() === "DELETE";

  const handleOpen = () => {
    setConfirmationInput("");
    setReason("");
    setErrorMessage("");
    setIsOpen(true);
  };

  const handleClose = () => {
    if (isDeleting) return;
    setIsOpen(false);
  };

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmed || isDeleting) return;

    setErrorMessage("");
    setIsDeleting(true);

    try {
      await deleteAccount(confirmationInput.trim(), reason.trim() || undefined);
      toast.success("Account deleted successfully.");
    } catch (err: unknown) {
      setIsDeleting(false);
      let message = "Failed to delete account. Please try again or contact support.";
      if (typeof err === "object" && err !== null) {
        const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
        if (typeof detail === "string") {
          if (detail.includes("CANNOT_DELETE_SOLE_ADMIN")) {
            message = "Cannot delete the sole administrator account. Another active administrator must remain.";
          } else {
            message = detail;
          }
        } else if (err instanceof Error) {
          message = err.message;
        }
      }
      setErrorMessage(message);
      toast.error(message);
    }
  };

  return (
    <div className={`rounded-2xl border border-red-200 bg-red-50/40 p-6 dark:border-red-950/60 dark:bg-red-950/20 ${className}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <ShieldAlert size={20} className="shrink-0" />
            <h3 className="text-base font-bold">Danger Zone: Delete {label} Account</h3>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Permanently delete your profile, documents, work history, and access tokens. This action is irreversible.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpen}
          id="open-delete-account-modal"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:hover:bg-red-500"
        >
          <Trash2 size={16} />
          <span>Delete Account</span>
        </button>
      </div>

      {/* Confirmation Dialog Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-dialog-title"
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
                  <AlertTriangle size={22} />
                </div>
                <div>
                  <h2 id="delete-account-dialog-title" className="text-lg font-bold text-slate-900 dark:text-white">
                    Permanently Delete Account?
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    This action cannot be undone.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={isDeleting}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
              <div className="rounded-xl border border-red-200 bg-red-50/50 p-3.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                <p className="font-semibold">By confirming account deletion, you understand that:</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs opacity-90">
                  <li>Your user profile, contact details, and authentication credentials will be permanently erased.</li>
                  <li>Uploaded verification documents, profile photos, and preferences will be purged.</li>
                  <li>Active sessions across all mobile and web devices will be immediately revoked.</li>
                  <li>You will not be able to log in or recover this account again.</li>
                </ul>
              </div>

              {errorMessage && (
                <div className="rounded-xl border border-red-300 bg-red-100/70 p-3 text-xs font-medium text-red-900 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200">
                  {errorMessage}
                </div>
              )}

              <form onSubmit={handleDelete} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="delete-reason-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Reason for leaving (optional):
                  </label>
                  <input
                    id="delete-reason-input"
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={isDeleting}
                    placeholder="Tell us why you are deleting your account"
                    maxLength={500}
                    className="mt-1 block w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label htmlFor="delete-confirm-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    To confirm, please type <span className="font-mono font-bold text-red-600 dark:text-red-400">DELETE</span> below:
                  </label>
                  <input
                    id="delete-confirm-input"
                    type="text"
                    value={confirmationInput}
                    onChange={(e) => setConfirmationInput(e.target.value)}
                    disabled={isDeleting}
                    autoFocus
                    autoComplete="off"
                    placeholder="Type DELETE"
                    className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={isDeleting}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    id="confirm-delete-account-button"
                    disabled={!isConfirmed || isDeleting}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Deleting Account...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 size={16} />
                        <span>Permanently Delete</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
