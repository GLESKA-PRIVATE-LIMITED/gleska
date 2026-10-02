"use client";

import React from "react";
import { ActionOption } from "./types";

interface AgentActionButtonProps {
  option: ActionOption;
}

export default function AgentActionButton({ option }: AgentActionButtonProps) {
  const Icon = option.icon;

  return (
    <div
      className={`group relative flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-lg shadow-slate-900/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:border-slate-800/80 dark:bg-slate-900/90 border-t-4 ${option.topBorderColor} cursor-pointer`}
    >
      <div className="space-y-1 min-w-0 pr-4">
        <span
          className={`font-mono text-xs font-bold uppercase tracking-wider ${option.badgeColor}`}
        >
          {option.optionNumber}
        </span>
        <h3 className="text-xl font-bold text-slate-900 dark:text-white truncate">
          {option.title}
        </h3>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 line-clamp-2">
          {option.description}
        </p>
      </div>
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${option.iconBg}`}
      >
        <Icon size={24} />
      </div>
    </div>
  );
}
