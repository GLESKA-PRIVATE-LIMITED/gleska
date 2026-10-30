"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  FileText,
  FolderKanban,
  ImageIcon,
  Loader2,
  MoreHorizontal,
  RotateCcw,
} from "lucide-react";
import {
  describeApiError,
  formatBytes,
  generalWorkApi,
  type GeneralWorkConversation,
  type GeneralWorkFile,
  type GeneralWorkMessage,
  type MessageAttachment,
} from "@/lib/general-work-api";
import ChatComposer from "./ChatComposer";
import MarkdownContent from "./MarkdownContent";
import StoredImage from "./StoredImage";
import { useGeneralWork } from "./GeneralWorkContext";
import { generalWorkRoutes } from "./generalWorkConfig";
import { downloadFile, openFile } from "./fileActions";
import { useConversationActions } from "./useConversationActions";

type ChatMessage = GeneralWorkMessage & {
  /** Local-only state for a user message that is sending or failed to send. */
  localState?: "pending" | "error";
  localError?: string;
};

interface ChatWorkspaceProps {
  conversationId?: string;
  projectId?: string | null;
}

const PAGE_SIZE = 30;
const STICK_TO_BOTTOM_PX = 120;

function attachmentsFromFiles(files: GeneralWorkFile[]): MessageAttachment[] {
  return files.map((file) => ({
    file_id: file.id,
    filename: file.filename,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    kind: file.kind,
    url: file.url,
  }));
}

export default function ChatWorkspace({ conversationId, projectId }: ChatWorkspaceProps) {
  const { projects, upsertConversation, setActiveConversationId, refreshProjects } = useGeneralWork();
  const [conversation, setConversation] = useState<GeneralWorkConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const preserveScrollRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const conversationRef = useRef<GeneralWorkConversation | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const actions = useConversationActions((updated) => {
    if (updated) {
      conversationRef.current = updated;
      setConversation(updated);
    }
  });

  const effectiveProjectId = conversation?.project_id ?? projectId ?? null;
  const project = effectiveProjectId ? projects.find((item) => item.id === effectiveProjectId) : undefined;

  useEffect(() => {
    if (!conversationId) {
      setActiveConversationId(null);
      return;
    }
    setActiveConversationId(conversationId);
    let cancelled = false;
    Promise.all([generalWorkApi.getConversation(conversationId), generalWorkApi.listMessages(conversationId, undefined, PAGE_SIZE)])
      .then(([loadedConversation, page]) => {
        if (cancelled) return;
        conversationRef.current = loadedConversation;
        setConversation(loadedConversation);
        setMessages(page.messages);
        setHasMore(page.has_more);
        stickToBottomRef.current = true;
      })
      .catch((error) => {
        if (cancelled) return;
        const status = (error as { response?: { status?: number } })?.response?.status;
        setLoadError(
          status === 404 || status === 422
            ? "This conversation doesn't exist or was deleted."
            : describeApiError(error, "Couldn't load this conversation."),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, setActiveConversationId]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (preserveScrollRef.current !== null) {
      container.scrollTop += container.scrollHeight - preserveScrollRef.current;
      preserveScrollRef.current = null;
      return;
    }
    if (stickToBottomRef.current) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const onScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    stickToBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < STICK_TO_BOTTOM_PX;
  };

  const loadOlder = async () => {
    const current = conversationRef.current;
    const oldest = messages.find((message) => !message.localState);
    if (!current || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await generalWorkApi.listMessages(current.id, oldest.created_at, PAGE_SIZE);
      preserveScrollRef.current = scrollRef.current?.scrollHeight ?? null;
      stickToBottomRef.current = false;
      setMessages((existing) => [...page.messages, ...existing]);
      setHasMore(page.has_more);
    } catch (error) {
      setLoadError(describeApiError(error, "Couldn't load earlier messages."));
    } finally {
      setLoadingOlder(false);
    }
  };

  const ensureConversation = useCallback(async (): Promise<GeneralWorkConversation> => {
    if (conversationRef.current) return conversationRef.current;
    const created = await generalWorkApi.createConversation(projectId);
    conversationRef.current = created;
    setConversation(created);
    upsertConversation(created);
    setActiveConversationId(created.id);
    // Update the address bar without remounting the view mid-send.
    window.history.replaceState(null, "", generalWorkRoutes.conversation(created.id));
    if (projectId) void refreshProjects();
    return created;
  }, [projectId, refreshProjects, setActiveConversationId, upsertConversation]);

  const deliver = useCallback(
    async (clientMessageId: string, content: string, files: GeneralWorkFile[]) => {
      const localId = `local-${clientMessageId}`;
      sendingRef.current = true;
      setSending(true);
      stickToBottomRef.current = true;
      try {
        const target = await ensureConversation();
        const exchange = await generalWorkApi.sendMessage(target.id, {
          content,
          attachment_ids: files.map((file) => file.id),
          client_message_id: clientMessageId,
        });
        conversationRef.current = exchange.conversation;
        setConversation(exchange.conversation);
        upsertConversation(exchange.conversation);
        setMessages((current) => {
          const withoutLocal = current.filter(
            (message) =>
              message.id !== localId &&
              message.id !== exchange.user_message.id &&
              message.id !== exchange.assistant_message.id,
          );
          return [...withoutLocal, exchange.user_message, exchange.assistant_message];
        });
      } catch (error) {
        const message = describeApiError(error, "Message not sent.");
        if (!messagesRef.current.some((item) => item.id === localId)) toast.error(message);
        setMessages((current) =>
          current.map((item) => (item.id === localId ? { ...item, localState: "error", localError: message } : item)),
        );
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [ensureConversation, upsertConversation],
  );

  const send = useCallback(
    async (content: string, files: GeneralWorkFile[]) => {
      if (sendingRef.current) return false;
      const clientMessageId = crypto.randomUUID();
      const optimistic: ChatMessage = {
        id: `local-${clientMessageId}`,
        conversation_id: conversationRef.current?.id ?? "",
        role: "user",
        content,
        attachments: attachmentsFromFiles(files),
        status: "completed",
        client_message_id: clientMessageId,
        created_at: new Date().toISOString(),
        localState: "pending",
      };
      setMessages((current) => [...current, optimistic]);
      void deliver(clientMessageId, content, files);
      return true;
    },
    [deliver],
  );

  const retry = (message: ChatMessage) => {
    if (sendingRef.current || !message.client_message_id) return;
    const files = message.attachments.map((attachment) => ({ id: attachment.file_id }) as GeneralWorkFile);
    if (message.localState) {
      setMessages((current) =>
        current.map((item) => (item.id === message.id ? { ...item, localState: "pending", localError: undefined } : item)),
      );
      void deliver(message.client_message_id, message.content, files);
      return;
    }
    // A stored failed reply: resending the same client id makes the server regenerate it.
    void deliver(message.client_message_id, message.content, files);
  };

  const isWelcome = !conversationId && messages.length === 0;

  if (isWelcome) {
    return (
      <div className="flex h-full flex-col bg-white dark:bg-slate-950">
        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
          <div className="w-full max-w-3xl">
            {project && (
              <p className="mb-4 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500">
                <FolderKanban size={14} /> New chat in {project.name}
              </p>
            )}
            <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
              Ready when you are.
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-center text-sm text-slate-500 dark:text-slate-400">
              Ask anything. Research, create, analyse and get work done with Gleska AI.
            </p>
            <div className="mt-8">
              <ChatComposer onSend={send} sending={sending} autoFocus />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const lastMessage = messages[messages.length - 1];
  const awaitingReply = sending && lastMessage?.role === "user";

  return (
    <div className="flex h-full flex-col bg-white dark:bg-slate-950">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {conversation?.title || (loading ? "Loading…" : "New chat")}
          </h1>
          {project && (
            <Link
              href={generalWorkRoutes.project(project.id)}
              className="hidden shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 sm:inline-flex dark:bg-slate-800 dark:text-slate-300"
            >
              <FolderKanban size={11} /> {project.name}
            </Link>
          )}
        </div>
        {conversation && (
          <ConversationMenu
            onRename={() => actions.open("rename", conversation)}
            onMove={() => actions.open("move", conversation)}
            onDelete={() => actions.open("delete", conversation)}
          />
        )}
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 size={24} className="animate-spin text-slate-400" />
            </div>
          ) : loadError && messages.length === 0 ? (
            <div className="mx-auto max-w-md rounded-2xl border border-slate-200 p-6 text-center dark:border-slate-800">
              <AlertCircle size={22} className="mx-auto text-slate-400" />
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{loadError}</p>
              <Link href={generalWorkRoutes.newChat} className="mt-4 inline-block text-sm font-semibold text-blue-600 hover:underline">
                Start a new chat
              </Link>
            </div>
          ) : (
            <>
              {hasMore && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadOlder()}
                    disabled={loadingOlder}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {loadingOlder && <Loader2 size={12} className="animate-spin" />}
                    Load earlier messages
                  </button>
                </div>
              )}
              {messages.map((message, index) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  onRetry={() => {
                    if (message.role === "user") retry(message);
                    else {
                      const prompt = [...messages.slice(0, index)].reverse().find((item) => item.role === "user");
                      if (prompt) retry(prompt);
                    }
                  }}
                  retryDisabled={sending}
                />
              ))}
              {awaitingReply && <ThinkingIndicator />}
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 px-3 pb-3 pt-2 sm:px-4">
        <div className="mx-auto w-full max-w-3xl">
          <ChatComposer onSend={send} sending={sending} placeholder="Ask anything" />
          <p className="mt-2 text-center text-[11px] text-slate-400">
            Gleska AI can make mistakes. Check important information.
          </p>
        </div>
      </div>
      {actions.dialog}
    </div>
  );
}

function ConversationMenu({ onRename, onMove, onDelete }: { onRename: () => void; onMove: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const item = (label: string, action: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        action();
      }}
      className={`block w-full px-3 py-2 text-left text-xs font-medium ${
        danger ? "text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-label="Conversation options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {item("Rename", onRename)}
          {item("Move to project", onMove)}
          {item("Delete", onDelete, true)}
        </div>
      )}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3" role="status" aria-label="Gleska AI is responding">
      <AssistantAvatar />
      <div className="flex gap-1">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="h-2 w-2 animate-bounce rounded-full bg-slate-300 dark:bg-slate-600" style={{ animationDelay: `${dot * 150}ms` }} />
        ))}
      </div>
    </div>
  );
}

function AssistantAvatar() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- matches the favicon logo used across agent layouts
    <img src="/favicon.ico" alt="" className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-slate-200 bg-white object-contain p-0.5 dark:border-slate-700" />
  );
}

function MessageItem({ message, onRetry, retryDisabled }: { message: ChatMessage; onRetry: () => void; retryDisabled: boolean }) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-2">
        {message.attachments.length > 0 && <AttachmentList attachments={message.attachments} align="end" />}
        {message.content && (
          <div
            className={`max-w-[85%] whitespace-pre-wrap break-words rounded-3xl bg-slate-100 px-4 py-2.5 text-[15px] leading-7 text-slate-900 dark:bg-slate-800 dark:text-slate-100 ${
              message.localState === "pending" ? "opacity-70" : ""
            }`}
          >
            {message.content}
          </div>
        )}
        {message.localState === "error" && (
          <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400">
            <AlertCircle size={13} /> {message.localError}
            <button type="button" onClick={onRetry} disabled={retryDisabled} className="inline-flex items-center gap-1 font-semibold underline disabled:opacity-50">
              <RotateCcw size={12} /> Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  const failed = message.status === "failed";
  return (
    <div className="flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        {failed ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <p className="flex items-start gap-2">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> {message.content}
            </p>
            <button type="button" onClick={onRetry} disabled={retryDisabled} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline disabled:opacity-50">
              <RotateCcw size={12} /> Try again
            </button>
          </div>
        ) : (
          <>
            <MarkdownContent content={message.content} />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  // Clipboard access may be blocked; nothing else to do.
                }
              }}
              className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="Copy response"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AttachmentList({ attachments, align }: { attachments: MessageAttachment[]; align: "start" | "end" }) {
  return (
    <div className={`flex max-w-[85%] flex-wrap gap-2 ${align === "end" ? "justify-end" : ""}`}>
      {attachments.map((attachment) =>
        attachment.kind === "image" ? (
          <button
            key={attachment.file_id}
            type="button"
            onClick={() => void openFile(attachment.file_id)}
            className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700"
            aria-label={`Open ${attachment.filename}`}
          >
            <StoredImage
              src={attachment.url}
              alt={attachment.filename}
              className="h-32 w-32 object-cover sm:h-40 sm:w-40"
              fallback={
                <span className="flex h-32 w-32 flex-col items-center justify-center gap-1 bg-slate-50 px-2 text-slate-500 sm:h-40 sm:w-40 dark:bg-slate-800">
                  <ImageIcon size={22} />
                  <span className="max-w-full truncate text-[11px]">{attachment.filename}</span>
                </span>
              }
            />
          </button>
        ) : (
          <div
            key={attachment.file_id}
            className="flex w-60 items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
              <FileText size={18} />
            </div>
            <button type="button" onClick={() => void openFile(attachment.file_id)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-xs font-semibold text-slate-800 hover:underline dark:text-slate-100">{attachment.filename}</p>
              <p className="text-[11px] text-slate-500">{formatBytes(attachment.size_bytes)}</p>
            </button>
            <button
              type="button"
              onClick={() => void downloadFile(attachment.file_id)}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={`Download ${attachment.filename}`}
            >
              <Download size={14} />
            </button>
          </div>
        ),
      )}
    </div>
  );
}
