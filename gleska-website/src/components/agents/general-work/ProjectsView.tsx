"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FolderKanban, Loader2, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { describeApiError, generalWorkApi, type GeneralWorkProject } from "@/lib/general-work-api";
import { ConfirmDialog, ProjectFormDialog } from "./Dialogs";
import { formatShortDate } from "./dateGroups";
import { useGeneralWork } from "./GeneralWorkContext";
import { generalWorkRoutes } from "./generalWorkConfig";

export default function ProjectsView() {
  const { refreshProjects, refreshConversations } = useGeneralWork();
  const [projects, setProjects] = useState<GeneralWorkProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GeneralWorkProject | null>(null);
  const [deleting, setDeleting] = useState<GeneralWorkProject | null>(null);

  const load = useCallback(
    () =>
      generalWorkApi
        .listProjects()
        .then((list) => {
          setProjects(list);
          setError(null);
        })
        .catch((err) => setError(describeApiError(err, "Couldn't load your projects.")))
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const afterChange = () => {
    void load();
    void refreshProjects();
  };

  return (
    <div className="h-full overflow-y-auto bg-[#f7f8fc] dark:bg-slate-950">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Projects</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Group related conversations so your work stays organised.</p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus size={16} /> New project
          </button>
        </div>

        <div className="mt-6">
          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 size={26} className="animate-spin text-slate-400" />
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              {error}{" "}
              <button type="button" onClick={() => void load()} className="font-semibold underline">
                Retry
              </button>
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-900">
              <FolderKanban size={28} className="mx-auto text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">No projects yet</p>
              <p className="mt-1 text-xs text-slate-500">Create a project, then start chats in it or move existing chats into it.</p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <li key={project.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                  <Link href={generalWorkRoutes.project(project.id)} className="group flex-1">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400">
                        <FolderKanban size={18} />
                      </div>
                      <h2 className="truncate text-sm font-bold text-slate-900 group-hover:underline dark:text-white">{project.name}</h2>
                    </div>
                    {project.description && (
                      <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{project.description}</p>
                    )}
                  </Link>
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500 dark:border-slate-800">
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare size={12} /> {project.conversation_count} chat{project.conversation_count === 1 ? "" : "s"} · {formatShortDate(project.updated_at)}
                    </span>
                    <span className="flex gap-0.5">
                      <button type="button" onClick={() => setEditing(project)} className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={`Rename ${project.name}`}>
                        <Pencil size={13} />
                      </button>
                      <button type="button" onClick={() => setDeleting(project)} className="rounded-lg p-1.5 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800" aria-label={`Delete ${project.name}`}>
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {creating && (
        <ProjectFormDialog
          title="New project"
          submitLabel="Create project"
          onClose={() => setCreating(false)}
          onSubmit={async (name, description) => {
            try {
              await generalWorkApi.createProject(name, description);
              toast.success("Project created.");
              setCreating(false);
              afterChange();
            } catch (err) {
              toast.error(describeApiError(err, "Couldn't create the project."));
            }
          }}
        />
      )}
      {editing && (
        <ProjectFormDialog
          title="Edit project"
          submitLabel="Save"
          initialName={editing.name}
          initialDescription={editing.description ?? ""}
          onClose={() => setEditing(null)}
          onSubmit={async (name, description) => {
            try {
              await generalWorkApi.updateProject(editing.id, { name, description: description || null });
              toast.success("Project updated.");
              setEditing(null);
              afterChange();
            } catch (err) {
              toast.error(describeApiError(err, "Couldn't update the project."));
            }
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete project?"
          description={`"${deleting.name}" will be deleted. Its conversations are kept and moved out of the project.`}
          confirmLabel="Delete project"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await generalWorkApi.deleteProject(deleting.id);
              toast.success("Project deleted.");
              setDeleting(null);
              afterChange();
              void refreshConversations();
            } catch (err) {
              toast.error(describeApiError(err, "Couldn't delete the project."));
            }
          }}
        />
      )}
    </div>
  );
}
