import React, { useState } from "react";
import { AlertTriangle, LoaderCircle, ShieldAlert, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { ApiError } from "../../lib/api";
import "./DeleteAccountSection.css";

interface DeleteAccountSectionProps {
  roleLabel?: string;
  className?: string;
}

export default function DeleteAccountSection({
  roleLabel,
  className = "",
}: DeleteAccountSectionProps) {
  const { user, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [reason, setReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const label =
    roleLabel ||
    (user?.role === "WORKER"
      ? "Worker"
      : user?.role === "EMPLOYER"
      ? "Employer"
      : user?.role === "ADMIN"
      ? "Administrator"
      : "Account");

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
      setIsOpen(false);
      navigate("/auth/signin", { replace: true });
    } catch (err: unknown) {
      setIsDeleting(false);
      let message = "Failed to delete account. Please try again or contact support.";
      if (err instanceof ApiError) {
        if (typeof err.detail === "string") {
          if (err.detail.includes("CANNOT_DELETE_SOLE_ADMIN")) {
            message = "Cannot delete the sole administrator account. Another active administrator must remain.";
          } else {
            message = err.detail;
          }
        } else {
          message = err.message;
        }
      } else if (err instanceof Error) {
        message = err.message;
      }
      setErrorMessage(message);
    }
  };

  return (
    <div className={`delete-account-card ${className}`}>
      <div className="delete-account-header">
        <div className="delete-account-icon-wrap" aria-hidden="true">
          <ShieldAlert size={20} />
        </div>
        <div className="delete-account-info">
          <h3 className="delete-account-title">Danger Zone: Delete {label} Account</h3>
          <p className="delete-account-description">
            Permanently delete your profile, documents, work history, and access tokens. This action is irreversible.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleOpen}
        id="open-delete-account-modal"
        className="delete-account-trigger-btn"
      >
        <Trash2 size={16} />
        <span>Delete Account</span>
      </button>

      {/* Confirmation Dialog Modal */}
      {isOpen && (
        <div
          className="delete-account-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !isDeleting) handleClose();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-dialog-title"
            className="delete-account-dialog"
          >
            <div className="delete-account-dialog-header">
              <div className="delete-account-dialog-title-group">
                <div className="delete-account-dialog-icon">
                  <AlertTriangle size={22} />
                </div>
                <div>
                  <h2 id="delete-account-dialog-title" className="delete-account-dialog-title">
                    Permanently Delete Account?
                  </h2>
                  <p className="delete-account-dialog-subtitle">This action cannot be undone.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={isDeleting}
                aria-label="Close dialog"
                className="delete-account-close-btn"
              >
                <X size={18} />
              </button>
            </div>

            <div className="delete-account-warning-box">
              <p>By confirming account deletion, you understand that:</p>
              <ul>
                <li>Your profile, contact details, and credentials will be permanently erased.</li>
                <li>Uploaded documents, verification photos, and data will be purged.</li>
                <li>Active sessions across all mobile and web devices will be revoked immediately.</li>
                <li>You will not be able to log in or recover this account again.</li>
              </ul>
            </div>

            {errorMessage && (
              <div className="delete-account-error-banner" role="alert">
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleDelete} className="delete-account-form">
              <div className="delete-account-field">
                <label htmlFor="delete-reason-input" className="delete-account-label">
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
                  className="delete-account-input"
                />
              </div>

              <div className="delete-account-field">
                <label htmlFor="delete-confirm-input" className="delete-account-label">
                  To confirm, please type <strong style={{ color: "#dc2626" }}>DELETE</strong> below:
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
                  className="delete-account-input"
                />
              </div>

              <div className="delete-account-actions">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isDeleting}
                  className="delete-account-cancel-btn"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="confirm-delete-account-button"
                  disabled={!isConfirmed || isDeleting}
                  className="delete-account-confirm-btn"
                >
                  {isDeleting ? (
                    <>
                      <LoaderCircle size={16} className="spin" />
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
      )}
    </div>
  );
}
