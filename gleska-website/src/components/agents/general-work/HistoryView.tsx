"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, MessageSquare, MoreHorizontal, Pencil, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { generalWorkApi, type GeneralWorkConversation } from "@/lib/general-work-api";
import { generalWorkRoutes } from "./generalWorkConfig";
import { groupByDate } from "./dateGroups";

const SEARCH_DEBOUNCE_MS = 300;

export default function HistoryView() {
  const [conversations, setConversations] = useState<GeneralWorkConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<GeneralWorkConversation | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const searchRequestRef = useRef(0);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await generalWorkApi.listConversations({ limit: 100 });
      setConversations(list);
    } catch {
      setError("Couldn't load your chat history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const term = query.trim();
    if (!term) return;
    const requestId = ++searchRequestRef.current;
    const timer = setTimeout(async () => {
      try {
        const results = await generalWorkApi.listConversations({ search: term, limit: 100 });
        if (searchRequestRef.current === requestId) setConversations(results);
      } catch {
        /* keep previous list on search failure */
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (query.trim() === "") void fetchAll();
  }, [query, fetchAll]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  const groups = useMemo(
    () => groupByDate(conversations, (conversation) => conversation.last_message_at),
    [conversations],
  );

  const handleRename = async () => {
    if (!renameFor || !renameValue.trim()) return;
    try {
      await generalWorkApi.updateConversation(renameFor.id, { title: renameValue.trim() });
      toast.success("Conversation renamed.");
      setRenameFor(null);
      setRenameValue("");
      await fetchAll();
    } catch {
      toast.error("Rename failed.");
    }
  };

  const handleDelete = async (conversation: GeneralWorkConversation) => {
    if (!confirm(`Delete "${conversation.title}"? This cannot be undone.`)) return;
    try {
      setDeletingId(conversation.id);
      await generalWorkApi.deleteConversation(conversation.id);
      toast.success("Conversation deleted.");
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
    } catch {
      toast.error("Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-6 sm:px-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Chat History</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">All your conversations with the General Work AI.</p>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-400">
            <Loader2 size={18} className="mr-2 animate-spin" /> Loading history…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
            {error}{" "}
            <button type="button" className="font-semibold underline" onClick={() => void fetchAll()}>
              Retry
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {query.trim() ? "No conversations match your search." : "No conversations yet. Start a new chat to see it here."}
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.label}>
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  {group.label}
                </h2>
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                  {group.items.map((conversation) => (
                    <li key={conversation.id} className="group relative flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <Link
                        href={generalWorkRoutes.conversation(conversation.id)}
                        className="flex min-w-0 flex-1 items-center gap-3"
                      >
                        <MessageSquare size={16} className="shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                            {conversation.title}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Last activity {new Date(conversation.last_message_at).toLocaleString()}
                          </p>
                        </div>
                      </Link>
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          aria-label={`Options for ${conversation.title}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuFor(menuFor === conversation.id ? null : conversation.id);
                          }}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        {menuFor === conversation.id && (
                          <div
                            onClick={(event) => event.stopPropagation()}
                            className="absolute right-0 top-full z-10 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
                            role="menu"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setRenameFor(conversation);
                                setRenameValue(conversation.title);
                                setMenuFor(null);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50"
                            >
                              <Pencil size={13} /> Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMenuFor(null);
                                void handleDelete(conversation);
                              }}
                              disabled={deletingId === conversation.id}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-900/30"
                            >
                              <Trash2 size={13} /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {renameFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
            <h3 className="mb-3 text-base font-bold text-slate-900 dark:text-white">Rename conversation</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleRename();
                if (event.key === "Escape") setRenameFor(null);
              }}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              autoFocus
              maxLength={200}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameFor(null)}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRename()}
                disabled={!renameValue.trim()}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
