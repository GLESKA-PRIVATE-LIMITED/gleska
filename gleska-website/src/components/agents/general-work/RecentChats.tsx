"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FolderInput, Loader2, MessageSquare, MoreHorizontal, Pencil, Search, Trash2, X } from "lucide-react";
import { generalWorkApi, type GeneralWorkConversation } from "@/lib/general-work-api";
import { groupByDate } from "./dateGroups";
import { useGeneralWork } from "./GeneralWorkContext";
import { generalWorkRoutes } from "./generalWorkConfig";
import { useConversationActions } from "./useConversationActions";

const SEARCH_DEBOUNCE_MS = 300;

export default function RecentChats({ onNavigate }: { onNavigate?: () => void }) {
  const { conversations, conversationsLoading, conversationsError, refreshConversations, activeConversationId } =
    useGeneralWork();
  const actions = useConversationActions();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeneralWorkConversation[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (!term) return;
    const requestId = ++requestRef.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await generalWorkApi.listConversations({ search: term, limit: 50 });
        if (requestRef.current === requestId) setSearchResults(results);
      } catch {
        if (requestRef.current === requestId) setSearchResults([]);
      } finally {
        if (requestRef.current === requestId) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  const isSearching = query.trim().length > 0;
  const list = isSearching ? searchResults ?? [] : conversations;
  const groups = groupByDate(list, (conversation) => conversation.last_message_at);

  return (
    <div className="flex h-full flex-col border-t border-slate-100 pt-4 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Recent Chats</h2>
      </div>

      <div className="relative mb-3">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!event.target.value.trim()) {
              requestRef.current += 1;
              setSearchResults(null);
              setSearching(false);
            }
          }}
          placeholder="Search chats"
          aria-label="Search conversations"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-8 text-xs text-slate-800 outline-none focus:border-blue-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:bg-slate-800"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              requestRef.current += 1;
              setSearchResults(null);
              setSearching(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="-mx-1 flex-1 space-y-4 px-1 pb-2">
        {(conversationsLoading && !isSearching) || (isSearching && searching && !searchResults) ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-slate-400">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : conversationsError && !isSearching ? (
          <div className="px-2 text-xs text-rose-600 dark:text-rose-400">
            {conversationsError}{" "}
            <button type="button" className="font-semibold underline" onClick={() => void refreshConversations()}>
              Retry
            </button>
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2 py-3 text-xs text-slate-400">
            {isSearching ? "No conversations match your search." : "Your conversations will appear here."}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((conversation) => {
                  const isActive = conversation.id === activeConversationId;
                  return (
                    <li key={conversation.id} className="group relative">
                      <Link
                        href={generalWorkRoutes.conversation(conversation.id)}
                        onClick={onNavigate}
                        title={conversation.title}
                        className={`flex items-center gap-2 rounded-lg py-2 pl-2 pr-8 text-[13px] transition ${
                          isActive
                            ? "bg-slate-100 font-semibold text-slate-900 dark:bg-slate-800 dark:text-white"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        }`}
                      >
                        <MessageSquare size={13} className="shrink-0 text-slate-400" />
                        <span className="truncate">{conversation.title}</span>
                      </Link>
                      <button
                        type="button"
                        aria-label={`Options for ${conversation.title}`}
                        aria-haspopup="menu"
                        aria-expanded={menuFor === conversation.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuFor(menuFor === conversation.id ? null : conversation.id);
                        }}
                        className={`absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white ${
                          menuFor === conversation.id || isActive ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                        }`}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      {menuFor === conversation.id && (
                        <div
                          role="menu"
                          onClick={(event) => event.stopPropagation()}
                          className="absolute right-1 top-9 z-20 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                        >
                          <MenuItem icon={Pencil} label="Rename" onClick={() => { setMenuFor(null); actions.open("rename", conversation); }} />
                          <MenuItem icon={FolderInput} label="Move to project" onClick={() => { setMenuFor(null); actions.open("move", conversation); }} />
                          <MenuItem icon={Trash2} label="Delete" danger onClick={() => { setMenuFor(null); actions.open("delete", conversation); }} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
      {actions.dialog}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium ${
        danger
          ? "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
          : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
