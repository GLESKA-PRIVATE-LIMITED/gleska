"use client";

import React, { useCallback, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { describeApiError, generalWorkApi, type GeneralWorkConversation } from "@/lib/general-work-api";
import { ConfirmDialog, MoveToProjectDialog, RenameDialog } from "./Dialogs";
import { useGeneralWork } from "./GeneralWorkContext";
import { generalWorkRoutes } from "./generalWorkConfig";

type ActionType = "rename" | "move" | "delete";

/** Rename / move-to-project / delete for a conversation, shared by the sidebar, chat header and projects. */
export function useConversationActions(onChanged?: (conversation: GeneralWorkConversation | null) => void) {
  const router = useRouter();
  const pathname = usePathname();
  const { projects, upsertConversation, removeConversation, refreshProjects } = useGeneralWork();
  const [pending, setPending] = useState<{ type: ActionType; conversation: GeneralWorkConversation } | null>(null);

  const open = useCallback((type: ActionType, conversation: GeneralWorkConversation) => {
    setPending({ type, conversation });
  }, []);

  const close = useCallback(() => setPending(null), []);

  let dialog: React.ReactNode = null;
  if (pending?.type === "rename") {
    dialog = (
      <RenameDialog
        title="Rename conversation"
        label="Title"
        initialValue={pending.conversation.title}
        maxLength={200}
        onClose={close}
        onSubmit={async (title) => {
          try {
            const updated = await generalWorkApi.updateConversation(pending.conversation.id, { title });
            upsertConversation(updated);
            onChanged?.(updated);
            close();
          } catch (error) {
            toast.error(describeApiError(error, "Couldn't rename the conversation."));
          }
        }}
      />
    );
  } else if (pending?.type === "move") {
    dialog = (
      <MoveToProjectDialog
        projects={projects}
        currentProjectId={pending.conversation.project_id}
        onClose={close}
        onSubmit={async (projectId) => {
          try {
            const updated = await generalWorkApi.updateConversation(
              pending.conversation.id,
              projectId ? { project_id: projectId } : { clear_project: true },
            );
            upsertConversation(updated);
            onChanged?.(updated);
            void refreshProjects();
            toast.success(projectId ? "Conversation moved to project." : "Conversation removed from project.");
            close();
          } catch (error) {
            toast.error(describeApiError(error, "Couldn't move the conversation."));
          }
        }}
      />
    );
  } else if (pending?.type === "delete") {
    dialog = (
      <ConfirmDialog
        title="Delete conversation?"
        description={`"${pending.conversation.title}" and its messages will be permanently deleted. Files stay in your Library.`}
        confirmLabel="Delete"
        onClose={close}
        onConfirm={async () => {
          try {
            await generalWorkApi.deleteConversation(pending.conversation.id);
            removeConversation(pending.conversation.id);
            onChanged?.(null);
            void refreshProjects();
            toast.success("Conversation deleted.");
            if (pathname === generalWorkRoutes.conversation(pending.conversation.id)) {
              router.push(generalWorkRoutes.newChat);
            }
            close();
          } catch (error) {
            toast.error(describeApiError(error, "Couldn't delete the conversation."));
          }
        }}
      />
    );
  }

  return { open, dialog };
}
