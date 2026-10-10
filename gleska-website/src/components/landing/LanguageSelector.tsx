"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { LanguageCode } from '@/lib/translations';

const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: 'EN', label: 'English' },
  { code: 'HI', label: 'हिन्दी' },
  { code: 'MR', label: 'मराठी' },
  { code: 'TA', label: 'தமிழ்' },
];

export interface LanguageSelectorProps {
  variant?: "default" | "menuItem";
  onSelectLanguage?: () => void;
  className?: string;
}

export default function LanguageSelector({
  variant = "default",
  onSelectLanguage,
  className = "",
}: LanguageSelectorProps) {
  const [open, setOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);

  const selected = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (variant === "menuItem") {
    return (
      <div ref={ref} className={`w-full ${className}`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Select language"
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <Globe size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
            <span>{t('nav.language') || "Language"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>{selected.code}</span>
            <ChevronDown size={14} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {open && (
          <div className="mt-1 space-y-1 rounded-xl bg-slate-50 p-1.5 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => {
                  setLanguage(lang.code);
                  setOpen(false);
                  if (onSelectLanguage) onSelectLanguage();
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition cursor-pointer ${
                  selected.code === lang.code
                    ? "bg-white text-indigo-600 shadow-sm font-bold dark:bg-slate-700 dark:text-indigo-300"
                    : "text-slate-700 hover:bg-white/60 dark:text-slate-200 dark:hover:bg-slate-700/60"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{lang.label}</span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">({lang.code})</span>
                </div>
                {selected.code === lang.code && <Check size={15} className="text-indigo-600 dark:text-indigo-400" />}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Select language"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400 cursor-pointer"
      >
        <Globe size={16} />
        <span>{selected.code}</span>
        <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-300/40 dark:border-slate-700 dark:bg-slate-800">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => {
                setLanguage(lang.code);
                setOpen(false);
                if (onSelectLanguage) onSelectLanguage();
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            >
              {lang.label}
              {selected.code === lang.code && <Check size={15} className="text-indigo-600 dark:text-indigo-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
