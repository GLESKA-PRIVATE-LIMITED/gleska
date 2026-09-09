import React from "react";
import { Loader2 } from "lucide-react";

export function WorkerPageFrame({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 ${className}`}>{children}</main>;
}

export function WorkerPageHeader({ eyebrow = "Worker workspace", title, description, action }: { eyebrow?: string; title: string; description: string; action?: React.ReactNode }) {
  return <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">{eyebrow}</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{description}</p></div>{action}</header>;
}

export function WorkspaceCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6 ${className}`}>{children}</section>;
}

export function WorkerLoadingState({ label = "Loading..." }: { label?: string }) {
  return <div className="flex items-center gap-2 py-8 text-sm text-slate-500 dark:text-slate-400" role="status"><Loader2 size={18} className="animate-spin" />{label}</div>;
}

export function WorkerErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300" role="alert"><p>{message}</p>{onRetry && <button type="button" onClick={onRetry} className="mt-3 font-bold underline">Try again</button>}</div>;
}

export function WorkerEmptyState({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">{icon && <div className="mb-3 flex justify-center text-slate-400">{icon}</div>}{children}</div>;
}
