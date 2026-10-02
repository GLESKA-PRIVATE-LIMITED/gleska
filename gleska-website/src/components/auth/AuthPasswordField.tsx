"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { getSignupPasswordRequirements } from "@/lib/signup-validation";

type PasswordRequirementLabels = {
  title: string;
  minimumLength: string;
  containsLetter: string;
  containsNumber: string;
  containsSpecialCharacter: string;
};

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
  passwordRequirementLabels?: PasswordRequirementLabels;
  validationMessage?: string;
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
  passwordRequirementLabels,
  validationMessage,
}: AuthPasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const passwordRequirements = getSignupPasswordRequirements(value);
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
          aria-invalid={Boolean(validationMessage)}
          aria-describedby={validationMessage ? `${id}-error` : undefined}
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
      {passwordRequirementLabels && <div className="grid gap-1 pt-1" aria-live="polite">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{passwordRequirementLabels.title}</span>
        {([
          ["minimumLength", passwordRequirementLabels.minimumLength],
          ["containsLetter", passwordRequirementLabels.containsLetter],
          ["containsNumber", passwordRequirementLabels.containsNumber],
          ["containsSpecialCharacter", passwordRequirementLabels.containsSpecialCharacter],
        ] as const).map(([requirement, text]) => {
          const satisfied = passwordRequirements[requirement];
          return (
            <span key={requirement} className={`flex items-center gap-1.5 text-xs font-medium ${satisfied ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {satisfied ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
              {text}
            </span>
          );
        })}
      </div>}
      {validationMessage && <span id={`${id}-error`} className="text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">{validationMessage}</span>}
    </label>
  );
}