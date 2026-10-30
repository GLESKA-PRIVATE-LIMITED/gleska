"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FolderKanban, Loader2, MessageSquare, MoreHorizontal, Pencil, SquarePen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  describeApiError,
  generalWorkApi,
  type GeneralWorkConversation,
  type GeneralWorkProject,
} from "@/lib/general-work-api";
import { ConfirmDialog, ProjectFormDialog } from "./Dialogs";
import { formatShortDate } from "./dateGroups";
import { useGeneralWork } from "./GeneralWorkContext";
import { generalWorkRoutes } from "./generalWorkConfig";
import { useConversationActions } from "./useConversationActions";

export default function ProjectDetailView({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { startNewChat, refreshProjects, refreshConversations } = useGeneralWork();
  const [project, setProject] = useState<GeneralWorkProject | null>(null);
  const [conversations, setConversations] = useState<GeneralWorkConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([
        generalWorkApi.getProject(projectId),
        generalWorkApi.listConversations({ projectId, limit: 100 }),
      ])
        .then(([loadedProject, loadedConversations]) => {
          setProject(loadedProject);
          setConversations(loadedConversations);
          setError(null);
        })
        .catch((err) => {
          const status = (err as { response?: { status?: number } })?.response?.status;
          setError(
            status === 404 || status === 422
              ? "This project doesn't exist or was deleted."
              : describeApiError(err, "Couldn't load this project."),
          );
        })
        .finally(() => setLoading(false)),
    [projectId],
  );

  const actions = useConversationActions(() => void load());

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={26} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-300">{error}</p>
        <Link href={generalWorkRoutes.projects} className="text-sm font-semibold text-blue-600 hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#f7f8fc] dark:bg-slate-950">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Link href={generalWorkRoutes.projects} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">
          <ArrowLeft size={14} /> All projects
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400">
              <FolderKanban size={22} />
            </div>
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-bold text-slate-900 dark:text-white">{project.name}</h1>
              {project.description && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-500 dark:text-slate-400">{project.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <Pencil size={14} /> Edit
            </button>
            <button type="button" onClick={() => setDeleting(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:border-slate-700 dark:bg-slate-900">
              <Trash2 size={14} /> Delete
            </button>
            <button type="button" onClick={() => startNewChat(project.id)} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <SquarePen size={14} /> New chat
            </button>
          </div>
        </div>

        <h2 className="mt-8 text-xs font-bold uppercase tracking-widest text-slate-400">Conversations</h2>
        {conversations.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
            No conversations in this project yet. Start a new chat here, or use &quot;Move to project&quot; on an existing chat.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {conversations.map((conversation) => (
              <li key={conversation.id} className="flex items-center gap-3 px-4 py-3">
                <MessageSquare size={16} className="shrink-0 text-slate-400" />
                <Link href={generalWorkRoutes.conversation(conversation.id)} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 hover:underline dark:text-slate-100">{conversation.title}</p>
                  <p className="text-[11px] text-slate-500">{formatShortDate(conversation.last_message_at)}</p>
                </Link>
                <ConversationRowMenu
                  onRename={() => actions.open("rename", conversation)}
                  onMove={() => actions.open("move", conversation)}
                  onDelete={() => actions.open("delete", conversation)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <ProjectFormDialog
          title="Edit project"
          submitLabel="Save"
          initialName={project.name}
          initialDescription={project.description ?? ""}
          onClose={() => setEditing(false)}
          onSubmit={async (name, description) => {
            try {
              setProject(await generalWorkApi.updateProject(project.id, { name, description: description || null }));
              void refreshProjects();
              toast.success("Project updated.");
              setEditing(false);
            } catch (err) {
              toast.error(describeApiError(err, "Couldn't update the project."));
            }
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete project?"
          description={`"${project.name}" will be deleted. Its conversations are kept and moved out of the project.`}
          confirmLabel="Delete project"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            try {
              await generalWorkApi.deleteProject(project.id);
              void refreshProjects();
              void refreshConversations();
              toast.success("Project deleted.");
              router.push(generalWorkRoutes.projects);
            } catch (err) {
              toast.error(describeApiError(err, "Couldn't delete the project."));
            }
          }}
        />
      )}
      {actions.dialog}
    </div>
  );
}

function ConversationRowMenu({ onRename, onMove, onDelete }: { onRename: () => void; onMove: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-label="Conversation options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <button type="button" role="menuitem" onClick={onRename} className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Rename</button>
          <button type="button" role="menuitem" onClick={onMove} className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Move to project</button>
          <button type="button" role="menuitem" onClick={onDelete} className="block w-full px-3 py-2 text-left text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">Delete</button>
        </div>
      )}
    </div>
  );
}
