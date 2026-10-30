"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  generalWorkApi,
  type GeneralWorkConversation,
  type GeneralWorkProject,
} from "@/lib/general-work-api";
import { generalWorkRoutes } from "./generalWorkConfig";

interface GeneralWorkContextValue {
  conversations: GeneralWorkConversation[];
  conversationsLoading: boolean;
  conversationsError: string | null;
  refreshConversations: () => Promise<void>;
  upsertConversation: (conversation: GeneralWorkConversation) => void;
  removeConversation: (conversationId: string) => void;
  projects: GeneralWorkProject[];
  refreshProjects: () => Promise<void>;
  activeConversationId: string | null;
  setActiveConversationId: (conversationId: string | null) => void;
  /** Changes on every New Chat so the chat view remounts with a clean state. */
  newChatKey: number;
  startNewChat: (projectId?: string | null) => void;
}

const GeneralWorkContext = createContext<GeneralWorkContextValue | null>(null);

const RECENT_CONVERSATION_LIMIT = 100;

function sortByRecent(conversations: GeneralWorkConversation[]): GeneralWorkConversation[] {
  return [...conversations].sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
  );
}

export function GeneralWorkProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<GeneralWorkConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [projects, setProjects] = useState<GeneralWorkProject[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [newChatKey, setNewChatKey] = useState(0);

  // State is only set in promise callbacks, so these are safe to start from an effect.
  const refreshConversations = useCallback(
    () =>
      generalWorkApi
        .listConversations({ limit: RECENT_CONVERSATION_LIMIT })
        .then((list) => {
          setConversations(list);
          setConversationsError(null);
        })
        .catch(() => setConversationsError("Couldn't load your conversations."))
        .finally(() => setConversationsLoading(false)),
    [],
  );

  const refreshProjects = useCallback(
    () =>
      generalWorkApi
        .listProjects()
        .then(setProjects)
        .catch(() => {
          // Project lists are refreshed again by the Projects pages, which surface errors.
        }),
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    void refreshConversations();
    void refreshProjects();
  }, [enabled, refreshConversations, refreshProjects]);

  const upsertConversation = useCallback((conversation: GeneralWorkConversation) => {
    setConversations((current) =>
      sortByRecent([conversation, ...current.filter((item) => item.id !== conversation.id)]),
    );
  }, []);

  const removeConversation = useCallback((conversationId: string) => {
    setConversations((current) => current.filter((item) => item.id !== conversationId));
    setActiveConversationId((current) => (current === conversationId ? null : current));
  }, []);

  const startNewChat = useCallback(
    (projectId?: string | null) => {
      setActiveConversationId(null);
      setNewChatKey((key) => key + 1);
      router.push(projectId ? generalWorkRoutes.newChatInProject(projectId) : generalWorkRoutes.newChat);
    },
    [router],
  );

  const value = useMemo<GeneralWorkContextValue>(
    () => ({
      conversations,
      conversationsLoading,
      conversationsError,
      refreshConversations,
      upsertConversation,
      removeConversation,
      projects,
      refreshProjects,
      activeConversationId,
      setActiveConversationId,
      newChatKey,
      startNewChat,
    }),
    [
      conversations,
      conversationsLoading,
      conversationsError,
      refreshConversations,
      upsertConversation,
      removeConversation,
      projects,
      refreshProjects,
      activeConversationId,
      newChatKey,
      startNewChat,
    ],
  );

  return <GeneralWorkContext.Provider value={value}>{children}</GeneralWorkContext.Provider>;
}

export function useGeneralWork(): GeneralWorkContextValue {
  const context = useContext(GeneralWorkContext);
  if (!context) throw new Error("useGeneralWork must be used inside GeneralWorkProvider");
  return context;
}
