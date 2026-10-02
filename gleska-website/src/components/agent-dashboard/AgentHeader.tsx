"use client";

import React from "react";
import { ShieldCheck } from "lucide-react";
import { AgentConfig } from "./types";
import AgentActionButton from "./AgentActionButton";

interface AgentHeaderProps {
  config: AgentConfig;
}

export default function AgentHeader({ config }: AgentHeaderProps) {
  if (config.variant === "compact-centered") {
    const isEmerald = config.accentColor === "emerald";
    const isCyan = config.accentColor === "cyan";

    let badgeStyle = "border-purple-200/90 bg-purple-50 text-purple-700 dark:border-purple-800/80 dark:bg-purple-950/70 dark:text-purple-300";
    let badgeIconStyle = "text-purple-600 dark:text-purple-400";
    let activeOptionStyle = "bg-purple-600 text-white font-bold shadow-xs dark:bg-purple-600";

    if (isEmerald) {
      badgeStyle = "border-emerald-200/90 bg-emerald-50 text-emerald-700 dark:border-emerald-800/80 dark:bg-emerald-950/70 dark:text-emerald-300";
      badgeIconStyle = "text-emerald-600 dark:text-emerald-400";
      activeOptionStyle = "bg-emerald-600 text-white font-bold shadow-xs dark:bg-emerald-600";
    } else if (isCyan) {
      badgeStyle = "border-cyan-200/90 bg-cyan-50 text-cyan-700 dark:border-cyan-800/80 dark:bg-cyan-950/70 dark:text-cyan-300";
      badgeIconStyle = "text-cyan-600 dark:text-cyan-400";
      activeOptionStyle = "bg-cyan-600 text-white font-bold shadow-xs dark:bg-cyan-600";
    }

    return (
      <div className="flex flex-col items-center text-center space-y-6 pt-2">
        {/* Title + Badge/Pill on the SAME LINE */}
        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          <h1 className="font-[var(--font-anton)] text-2xl sm:text-3xl md:text-4xl lg:text-[2.75rem] uppercase tracking-wide text-slate-900 dark:text-white leading-none">
            {config.title}
          </h1>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] sm:text-xs font-bold uppercase tracking-wider shadow-2xs ${badgeStyle}`}>
            <ShieldCheck size={13} className={badgeIconStyle} />
            {config.badgeText}
          </span>
        </div>

        {/* Compact Segmented Control for Options */}
        <div className="inline-flex items-center rounded-full border border-slate-200/90 bg-white/95 p-1.5 shadow-sm backdrop-blur-md dark:border-slate-800/90 dark:bg-slate-900/95">
          {config.actionOptions.map((option, index) => {
            const Icon = option.icon;
            const isFirst = index === 0;
            return (
              <button
                key={option.id}
                type="button"
                className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
                  isFirst
                    ? activeOptionStyle
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/70"
                }`}
              >
                <Icon size={16} />
                <span>{option.title}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Badge */}
      <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
        <ShieldCheck size={14} />
        {config.badgeText}
      </div>

      {/* Title */}
      <h1 className="font-[var(--font-anton)] text-3xl sm:text-5xl md:text-6xl uppercase tracking-wide text-slate-900 dark:text-white">
        {config.title}
      </h1>

      {/* Action Options Directly Below Heading */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
        {config.actionOptions.map((option) => (
          <AgentActionButton key={option.id} option={option} />
        ))}
      </div>
    </div>
  );
}
