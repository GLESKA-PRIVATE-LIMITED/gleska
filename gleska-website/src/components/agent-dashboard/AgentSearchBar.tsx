"use client";

import React from "react";
import { Search } from "lucide-react";

interface AgentSearchBarProps {
  title: string;
  subtitle: string;
  placeholder: string;
  variant?: "default" | "compact-centered";
}

export default function AgentSearchBar({
  title,
  subtitle,
  placeholder,
  variant = "default",
}: AgentSearchBarProps) {
  if (variant === "compact-centered") {
    return (
      <div className="mx-auto max-w-2xl pt-24 sm:pt-32 md:pt-40">
        <div className="relative flex items-center">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
            <Search size={18} />
          </div>
          <input
            type="text"
            placeholder={placeholder}
            className="w-full rounded-full border border-slate-200/90 bg-white/95 py-3.5 pl-11 pr-4 text-xs sm:text-sm font-medium text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-800 dark:bg-slate-900/95 dark:text-white dark:focus:border-indigo-500"
            readOnly
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pt-6 sm:pt-12">
      <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-6 sm:p-8 shadow-xl backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/80">
        <div className="mb-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            {title}
          </h3>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {subtitle}
          </p>
        </div>

        {/* Search Bar Input Element */}
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
            <Search size={20} />
          </div>
          <input
            type="text"
            placeholder={placeholder}
            className="w-full rounded-2xl border border-slate-200/90 bg-slate-50/70 py-4 pl-12 pr-4 text-sm font-medium text-slate-900 shadow-inner outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-800 dark:bg-slate-800/70 dark:text-white dark:focus:border-indigo-500 dark:focus:bg-slate-900"
            readOnly
          />
        </div>
      </div>
    </div>
  );
}
