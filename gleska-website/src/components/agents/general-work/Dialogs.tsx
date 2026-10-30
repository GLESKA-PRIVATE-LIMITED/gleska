"use client";

import React, { useEffect, useId, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { GeneralWorkProject } from "@/lib/general-work-api";

interface ModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function Modal({ title, description, onClose, children }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <button type="button" aria-label="Close dialog" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-bold text-slate-900 dark:text-white">
              {title}
            </h3>
            {description && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white";
const primaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50";
const secondaryButton =
  "rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800";
const dangerButton =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50";

function DialogActions({
  busy,
  submitLabel,
  disabled,
  danger,
  onCancel,
}: {
  busy: boolean;
  submitLabel: string;
  disabled?: boolean;
  danger?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className={secondaryButton}>
        Cancel
      </button>
      <button type="submit" disabled={busy || disabled} className={danger ? dangerButton : primaryButton}>
        {busy && <Loader2 size={14} className="animate-spin" />}
        {submitLabel}
      </button>
    </div>
  );
}

export function RenameDialog({
  title,
  label,
  initialValue,
  maxLength,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initialValue: string;
  maxLength: number;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!value.trim()) return;
          setBusy(true);
          try {
            await onSubmit(value.trim());
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          {label}
        </label>
        <input
          id={inputId}
          value={value}
          maxLength={maxLength}
          onChange={(event) => setValue(event.target.value)}
          className={inputClass}
          autoFocus
        />
        <DialogActions busy={busy} submitLabel="Save" disabled={!value.trim()} onCancel={onClose} />
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} description={description} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
          }
        }}
      >
        <DialogActions busy={busy} submitLabel={confirmLabel} danger onCancel={onClose} />
      </form>
    </Modal>
  );
}

export function ProjectFormDialog({
  title,
  initialName = "",
  initialDescription = "",
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initialName?: string;
  initialDescription?: string;
  submitLabel: string;
  onSubmit: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const descriptionId = useId();

  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          try {
            await onSubmit(name.trim(), description.trim());
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        <div>
          <label htmlFor={nameId} className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Project name
          </label>
          <input
            id={nameId}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Plant expansion 2027"
            className={inputClass}
            autoFocus
          />
        </div>
        <div>
          <label htmlFor={descriptionId} className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Description <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id={descriptionId}
            value={description}
            maxLength={2000}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is this project about?"
            className={`${inputClass} resize-none`}
          />
        </div>
        <DialogActions busy={busy} submitLabel={submitLabel} disabled={!name.trim()} onCancel={onClose} />
      </form>
    </Modal>
  );
}

export function MoveToProjectDialog({
  projects,
  currentProjectId,
  onSubmit,
  onClose,
}: {
  projects: GeneralWorkProject[];
  currentProjectId: string | null;
  onSubmit: (projectId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string>(currentProjectId ?? "");
  const [busy, setBusy] = useState(false);
  const selectId = useId();

  return (
    <Modal title="Move to project" description="Group this conversation with a project." onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await onSubmit(selected || null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {projects.length === 0 ? (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            You don&apos;t have any projects yet. Create one from the Projects page.
          </p>
        ) : (
          <>
            <label htmlFor={selectId} className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Project
            </label>
            <select
              id={selectId}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className={inputClass}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </>
        )}
        <DialogActions
          busy={busy}
          submitLabel="Save"
          disabled={projects.length === 0 || selected === (currentProjectId ?? "")}
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}
