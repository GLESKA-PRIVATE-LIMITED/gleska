"use client";

import React from "react";
import {
  AlertTriangle,
  BadgeCheck,
  BrainCircuit,
  ChevronDown,
  Database,
  ExternalLink,
  FileText,
  Loader2,
  Paperclip,
  Search,
  SendHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import MarkdownContent from "@/components/agents/general-work/MarkdownContent";
import { SUGGESTED_QUESTIONS, buildCompanyBrainConfig } from "@/components/agents/company-brain/companyBrainConfig";
import {
  brainErrorText,
  companyBrainApi,
  sourcesFromMessage,
  type BrainAnswer,
  type BrainConversation,
  type BrainDocument,
  type BrainSource,
  type BrainStatus,
} from "@/lib/company-brain-api";

interface ChatItem {
  key: string;
  role: "user" | "assistant";
  content: string;
  answerStatus?: BrainAnswer["answer_status"] | null;
  sources?: BrainSource[];
  limitations?: string[];
  conflicts?: string[];
  failed?: boolean;
  at?: string;
}

const STAGES = ["Understanding your question…", "Retrieving company records…", "Calculating and checking against the evidence…"];
const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp";

const STATUS_BADGE: Record<string, { text: string; tone: string }> = {
  validated: { text: "Verified against company records", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  regenerated: { text: "Verified against company records", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  fallback: { text: "Shown directly from company records", tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  not_verified: { text: "Not verifiable from records", tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  clarification: { text: "Needs clarification", tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  general: { text: "General information – not company data", tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

function fromAnswer(answer: BrainAnswer): ChatItem {
  return {
    key: answer.message_id ?? `a-${Date.now()}`,
    role: "assistant",
    content: answer.answer,
    answerStatus: answer.answer_status,
    sources: answer.sources,
    limitations: answer.limitations,
    conflicts: answer.conflicts,
    at: answer.generated_at,
  };
}

function SourceList({ sources }: { sources: BrainSource[] }) {
  const [open, setOpen] = React.useState(false);
  if (sources.length === 0) return null;
  const openDocument = (id: string) =>
    companyBrainApi
      .documentUrl(id)
      .then((url) => window.open(url, "_blank", "noopener,noreferrer"))
      .catch((e) => toast.error(brainErrorText(e, "This document can't be opened.")));
  return (
    <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
      >
        <span className="inline-flex items-center gap-1.5"><Database size={13} /> Sources ({sources.length})</span>
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 text-xs dark:divide-slate-800 dark:border-slate-800">
          {sources.map((s) => (
            <li key={s.id} className="px-3 py-2" data-testid="brain-source">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-slate-800 dark:text-slate-100">
                  <span className="mr-1 rounded bg-slate-100 px-1 font-mono text-[10px] dark:bg-slate-800">{s.id}</span>
                  {s.label}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.freshness === "live" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"}`}>
                  {s.freshness === "live" ? "Live" : "Indexed"}
                </span>
              </div>
              <p className={`mt-1 text-slate-700 dark:text-slate-300 ${s.source_type === "document" ? "line-clamp-3 italic" : "font-medium"}`}>{s.value}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {s.source_agent} · {s.source_type === "document" ? "document" : s.source_table}
                {s.period ? ` · ${s.period}` : ""}
                {s.record_count != null ? ` · ${s.record_count} record(s)` : ""}
                {` · retrieved ${new Date(s.retrieved_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}
              </p>
              {s.document_id && (
                <button type="button" onClick={() => void openDocument(s.document_id!)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:underline">
                  <ExternalLink size={11} /> Open document
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssistantMessage({ item }: { item: ChatItem }) {
  const badge = item.answerStatus ? STATUS_BADGE[item.answerStatus] : null;
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
        <BrainCircuit size={16} />
      </div>
      <div className="min-w-0 flex-1">
        {item.failed ? (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{item.content}</p>
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert"><MarkdownContent content={item.content} /></div>
        )}
        {badge && (
          <span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.tone}`}>
            <BadgeCheck size={12} /> {badge.text}
          </span>
        )}
        {(item.conflicts?.length ?? 0) > 0 && (
          <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-semibold">Conflicting records</p>
            <ul className="list-disc pl-4">{item.conflicts!.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
        {(item.limitations?.length ?? 0) > 0 && item.answerStatus !== "fallback" && item.answerStatus !== "not_verified" && (
          <details className="mt-2 text-xs text-slate-500">
            <summary className="cursor-pointer font-semibold">Limitations ({item.limitations!.length})</summary>
            <ul className="mt-1 list-disc pl-4">{item.limitations!.map((l) => <li key={l}>{l}</li>)}</ul>
          </details>
        )}
        <SourceList sources={item.sources ?? []} />
      </div>
    </div>
  );
}

function DocumentsPanel({ status }: { status: BrainStatus | null }) {
  const [docs, setDocs] = React.useState<BrainDocument[] | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const load = React.useCallback(() => companyBrainApi.documents().then(setDocs).catch(() => setDocs([])), []);
  React.useEffect(() => {
    void load();
  }, [load]);

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        await companyBrainApi.upload(file);
        toast.success(`${file.name} uploaded. It will be searchable once indexed.`);
      } catch (e) {
        toast.error(`${file.name}: ${brainErrorText(e, "Upload failed.")}`);
      }
    }
    setUploading(false);
    void load();
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <section>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Connected sources</h2>
        <p className="mt-1 text-sm text-slate-500">Company Brain reads these agents&apos; records directly, so answers use current data.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(status?.sources ?? []).map((s) => (
            <div key={s.agent} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
              <span>{s.agent}</span>
              <span className={`text-xs font-semibold ${s.status === "connected" ? "text-emerald-600" : "text-slate-400"}`}>
                {s.status === "connected" ? (s.freshness === "indexed" ? "Connected · indexed" : "Connected · live") : "No data yet"}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Company documents</h2>
            <p className="mt-1 text-sm text-slate-500">Contracts, policies and reports. General Work files and scanned bills are included automatically.</p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload
            <input type="file" multiple accept={ACCEPT} className="sr-only" disabled={uploading} onChange={(e) => void onUpload(e.target.files)} aria-label="Upload documents" />
          </label>
        </div>
        {status && status.documents_without_embeddings > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {status.documents_without_embeddings} document(s) are searchable by keyword only; semantic search needs the embedding model to be set up.
          </p>
        )}
        {!docs ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : docs.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">No documents yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText size={15} className="shrink-0 text-slate-400" />
                  <span className="truncate">{d.filename}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {d.source_type === "upload" ? "Uploaded" : d.source_type === "general_work_file" ? "General Work" : "Scanned bill"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className={`text-xs ${d.status === "indexed" ? "text-emerald-600" : d.status === "failed" ? "text-rose-600" : "text-slate-500"}`}>
                    {d.status === "indexed" ? `Indexed${d.embedding_status === "embedded" ? "" : " (keyword)"}` : d.status === "failed" ? "Could not read" : "Indexing…"}
                  </span>
                  {d.source_type === "upload" && (
                    <button
                      type="button"
                      aria-label={`Delete ${d.filename}`}
                      onClick={() => void companyBrainApi.deleteDocument(d.id).then(load).catch((e) => toast.error(brainErrorText(e)))}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function CompanyBrainWorkspace() {
  const [view, setView] = React.useState<"chat" | "documents">("chat");
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<ChatItem[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [stage, setStage] = React.useState(0);
  const [conversations, setConversations] = React.useState<BrainConversation[]>([]);
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<BrainStatus | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  const loadConversations = React.useCallback(
    (term = "") => companyBrainApi.conversations(term || undefined).then(setConversations).catch(() => undefined),
    [],
  );
  React.useEffect(() => {
    void loadConversations();
    void companyBrainApi.status().then(setStatus).catch(() => undefined);
  }, [loadConversations]);
  React.useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [items.length]);
  React.useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 2500);
    return () => window.clearInterval(timer);
  }, [busy]);

  const newChat = React.useCallback(() => {
    setConversationId(null);
    setItems([]);
    setView("chat");
  }, []);

  const openConversation = (id: string) =>
    companyBrainApi
      .conversation(id)
      .then(({ messages }) => {
        setConversationId(id);
        setView("chat");
        setItems(
          messages.map((m) => ({
            key: m.id,
            role: m.role,
            content: m.content,
            answerStatus: m.answer_status,
            sources: m.role === "assistant" ? sourcesFromMessage(m) : [],
            limitations: m.evidence?.limitations ?? [],
            conflicts: m.evidence?.conflicts ?? [],
            failed: m.status === "failed",
          })),
        );
      })
      .catch((e) => toast.error(brainErrorText(e)));

  const run = async (question: string, call: () => Promise<BrainAnswer>) => {
    setItems((prev) => [...prev, { key: `u-${Date.now()}`, role: "user", content: question }]);
    setInput("");
    setStage(0);
    setBusy(true);
    try {
      const answer = await call();
      setConversationId(answer.conversation_id);
      setItems((prev) => [...prev, fromAnswer(answer)]);
      void loadConversations(search);
    } catch (e) {
      setItems((prev) => [...prev, { key: `e-${Date.now()}`, role: "assistant", content: brainErrorText(e), failed: true }]);
    } finally {
      setBusy(false);
    }
  };

  const send = (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    void run(question, () => companyBrainApi.ask(question, conversationId));
  };

  const summary = (name: string, label: string) => {
    if (busy) return;
    void run(`${label} company summary`, () => companyBrainApi.summary(name, conversationId));
  };

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        await companyBrainApi.upload(file);
        toast.success(`${file.name} added to company documents. Ask about it once it's indexed.`);
      } catch (e) {
        toast.error(`${file.name}: ${brainErrorText(e, "Upload failed.")}`);
      }
    }
  };

  const config = React.useMemo(() => buildCompanyBrainConfig({ onNewChat: newChat, onDocuments: () => setView("documents") }), [newChat]);

  const sidebar = ({ closeMobileSidebar }: { closeMobileSidebar: () => void }) => (
    <div className="space-y-2 px-2">
      <div className="relative">
        <Search size={13} className="absolute left-2 top-2.5 text-slate-400" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            void loadConversations(e.target.value);
          }}
          placeholder="Search conversations"
          aria-label="Search conversations"
          className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-xs dark:border-slate-700 dark:bg-slate-900"
        />
      </div>
      <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
        {conversations.map((c) => (
          <li key={c.id} className="group flex items-center">
            <button
              type="button"
              onClick={() => {
                void openConversation(c.id);
                closeMobileSidebar();
              }}
              className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs ${c.id === conversationId ? "bg-violet-50 font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
            >
              {c.title}
            </button>
            <button
              type="button"
              aria-label={`Delete ${c.title}`}
              onClick={() =>
                void companyBrainApi.remove(c.id).then(() => {
                  if (c.id === conversationId) newChat();
                  return loadConversations(search);
                })
              }
              className="hidden px-1 text-slate-400 hover:text-rose-600 group-hover:block"
            >
              <Trash2 size={12} />
            </button>
          </li>
        ))}
        {conversations.length === 0 && <li className="px-2 py-1 text-xs text-slate-400">No conversations yet</li>}
      </ul>
    </div>
  );

  return (
    <AgentLayout config={config} workspace sidebarContent={sidebar} activeTab={view === "documents" ? "documents" : "new-chat"}>
      {view === "documents" ? (
        <DocumentsPanel status={status} />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-12 text-center sm:py-20">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                  <BrainCircuit size={28} />
                </div>
                <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">Your Company. One Intelligence Layer.</h1>
                <p className="mt-2 max-w-xl text-sm text-slate-500">Ask anything about your organisation. Get answers backed by your company&apos;s actual data.</p>
                <div className="mt-8 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button key={q} type="button" onClick={() => send(q)} className="rounded-xl border border-slate-200 px-4 py-3 text-left text-sm text-slate-700 hover:border-violet-300 hover:bg-violet-50/50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-violet-950/30">
                      {q}
                    </button>
                  ))}
                </div>
                <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs">
                  {[["today", "Today's"], ["this_week", "This week's"], ["this_month", "This month's"], ["this_quarter", "This quarter's"]].map(([name, label]) => (
                    <button key={name} type="button" onClick={() => summary(name, label)} className="rounded-full border border-violet-200 px-3 py-1 font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300">
                      {label} summary
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
                {items.map((item) =>
                  item.role === "user" ? (
                    <div key={item.key} className="flex justify-end">
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-violet-600 px-4 py-2 text-sm text-white">{item.content}</p>
                    </div>
                  ) : (
                    <AssistantMessage key={item.key} item={item} />
                  ),
                )}
                {busy && (
                  <div role="status" className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 size={16} className="animate-spin text-violet-600" /> {STAGES[stage]}
                  </div>
                )}
                <div ref={endRef} />
              </div>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
          >
            <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-2 focus-within:border-violet-400 dark:border-slate-700 dark:bg-slate-900">
              <label className="cursor-pointer pb-1 text-slate-400 hover:text-violet-600" title="Add a company document">
                <Paperclip size={18} />
                <input type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => void attach(e.target.files)} aria-label="Attach document" />
              </label>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder="Ask about your company…"
                aria-label="Ask Company Brain"
                className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-sm outline-none"
              />
              <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="rounded-full bg-violet-600 p-2 text-white disabled:opacity-40">
                <SendHorizontal size={16} />
              </button>
            </div>
            <p className="mx-auto mt-1.5 flex max-w-3xl items-center gap-1 text-[11px] text-slate-400">
              <AlertTriangle size={11} /> Answers come only from your Gleska records. Missing data is reported as missing, never guessed.
            </p>
          </form>
        </div>
      )}
    </AgentLayout>
  );
}
