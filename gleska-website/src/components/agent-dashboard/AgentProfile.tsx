"use client";

import React from "react";
import { User } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface AgentProfileProps {
  isCollapsed?: boolean;
}

export default function AgentProfile({ isCollapsed = false }: AgentProfileProps) {
  const { user } = useAuth();

  const userInitial = user?.full_name
    ? user.full_name.charAt(0).toUpperCase()
    : null;

  return (
    <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
      {!isCollapsed && (
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 px-1">
          Your Profile
        </div>
      )}
      <div
        className={`flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 shadow-xs dark:border-slate-800 dark:bg-slate-800/80 ${
          isCollapsed ? "justify-center p-2.5" : ""
        }`}
        title={user?.full_name || user?.email || "Guest User"}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 font-bold dark:bg-indigo-900/60 dark:text-indigo-300">
          {userInitial ? userInitial : <User size={20} />}
        </div>
        {!isCollapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-slate-900 dark:text-white">
              {user?.full_name || user?.name || "Guest User"}
            </p>
            <p className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {user?.email || user?.phone || "Agent Operator"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
