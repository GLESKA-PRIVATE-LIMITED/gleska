"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type AuthPasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  strengthLabel?: string;
  requirementsText?: string;
  minLength?: number;
  maxLength?: number;
};

export default function AuthPasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  strengthLabel,
  requirementsText,
  minLength,
  maxLength,
}: AuthPasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const characterGroups = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[^a-zA-Z\d]/.test(value)].filter(Boolean).length;
  const score = value ? Number(value.length >= 8) + Number(value.length >= 12) + Number(characterGroups >= 2) + Number(characterGroups >= 3) : 0;
  const strength = score < 2 ? "Weak" : score < 3 ? "Fair" : score < 4 ? "Good" : "Strong";
  const strengthColor = score < 2 ? "bg-rose-500" : score < 3 ? "bg-amber-500" : "bg-emerald-600";

  return (
    <label htmlFor={id} className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
      <span>{label}</span>
      <span className="relative block min-w-0">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          maxLength={maxLength}
          placeholder={label}
          className="min-h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
        />
        <button
          type="button"
          className="absolute inset-y-0 right-2 inline-flex min-h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-slate-800 dark:hover:text-white"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
      {strengthLabel && <span className="flex items-center justify-between gap-3 text-xs font-medium text-slate-500">
        {requirementsText && <span>{requirementsText}</span>}
        <span className="shrink-0" role="status">{strengthLabel}{value ? `: ${strength}` : ""}</span>
      </span>}
      {strengthLabel && <span className="grid grid-cols-4 gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => <span key={step} className={`h-1 rounded-full ${score >= step ? strengthColor : "bg-slate-200 dark:bg-slate-700"}`} />)}
      </span>}
    </label>
  );
}