"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  UPLOAD_RULES,
  describeApiError,
  formatBytes,
  generalWorkApi,
  type GeneralWorkFile,
  type GeneralWorkFileKind,
} from "@/lib/general-work-api";
import { ConfirmDialog } from "./Dialogs";
import { formatShortDate } from "./dateGroups";
import { downloadFile, openFile } from "./fileActions";
import { generalWorkRoutes } from "./generalWorkConfig";
import StoredImage from "./StoredImage";
import { classifyFile } from "./useAttachmentUploads";

type Filter = "all" | GeneralWorkFileKind;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "document", label: "Documents" },
];

const SOURCE_LABELS: Record<GeneralWorkFile["source"], string> = {
  upload: "Uploaded",
  camera: "Camera",
  generated: "Generated",
};

function typeLabel(file: GeneralWorkFile): string {
  const ext = file.filename.split(".").pop()?.toUpperCase();
  return ext && ext.length <= 5 ? ext : file.kind === "image" ? "IMAGE" : "FILE";
}

function FileIcon({ file, size = 22 }: { file: GeneralWorkFile; size?: number }) {
  if (file.kind === "image") return <ImageIcon size={size} />;
  if (/\.(xlsx|csv)$/i.test(file.filename)) return <FileSpreadsheet size={size} />;
  return <FileText size={size} />;
}

function SourceIcon({ source }: { source: GeneralWorkFile["source"] }) {
  if (source === "camera") return <Camera size={11} />;
  if (source === "generated") return <Sparkles size={11} />;
  return <Upload size={11} />;
}

export default function LibraryView() {
  const [files, setFiles] = useState<GeneralWorkFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [toDelete, setToDelete] = useState<GeneralWorkFile | null>(null);
  const [uploading, setUploading] = useState(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  const load = useCallback(async (kind: Filter, term: string) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const items = await generalWorkApi.listFiles({ kind: kind === "all" ? undefined : kind, search: term.trim(), limit: 200 });
      if (requestRef.current === requestId) {
        setFiles(items);
        setError(null);
      }
    } catch (err) {
      if (requestRef.current === requestId) setError(describeApiError(err, "Couldn't load your library."));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(filter, search), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [filter, search, load]);

  const uploadFiles = async (selected: File[]) => {
    for (const file of selected) {
      const result = classifyFile(file);
      if ("error" in result) {
        toast.error(result.error);
        continue;
      }
      setUploading((count) => count + 1);
      try {
        await generalWorkApi.uploadFile(file, file.name, "upload");
        toast.success(`${file.name} saved to your Library.`);
      } catch (err) {
        toast.error(describeApiError(err, `Couldn't upload ${file.name}.`));
      } finally {
        setUploading((count) => count - 1);
      }
    }
    void load(filter, search);
  };

  return (
    <div className="h-full overflow-y-auto bg-[#f7f8fc] dark:bg-slate-950">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Library</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Images and documents you upload or capture in your chats are saved here automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploading > 0}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {uploading > 0 ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Upload
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            accept={`${UPLOAD_RULES.image.accept},${UPLOAD_RULES.document.accept}`}
            className="hidden"
            onChange={(event) => {
              const selected = Array.from(event.target.files || []);
              event.target.value = "";
              if (selected.length) void uploadFiles(selected);
            }}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900" role="tablist" aria-label="Filter by type">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                onClick={() => setFilter(item.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  filter === item.id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by file name"
              aria-label="Search library"
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            <button type="button" onClick={() => setView("grid")} aria-label="Grid view" aria-pressed={view === "grid"} className={`rounded-lg p-1.5 ${view === "grid" ? "bg-slate-100 dark:bg-slate-800" : ""}`}>
              <LayoutGrid size={16} />
            </button>
            <button type="button" onClick={() => setView("list")} aria-label="List view" aria-pressed={view === "list"} className={`rounded-lg p-1.5 ${view === "list" ? "bg-slate-100 dark:bg-slate-800" : ""}`}>
              <List size={16} />
            </button>
          </div>
        </div>

        <div className="mt-6">
          {loading && files.length === 0 ? (
            <div className="flex justify-center py-20">
              <Loader2 size={26} className="animate-spin text-slate-400" />
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              {error}{" "}
              <button type="button" onClick={() => void load(filter, search)} className="font-semibold underline">
                Retry
              </button>
            </div>
          ) : files.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-900">
              <ImageIcon size={28} className="mx-auto text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                {search || filter !== "all" ? "No files match your filters." : "Your library is empty."}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Attach files in a <Link href={generalWorkRoutes.newChat} className="font-semibold text-blue-600 hover:underline">chat</Link> or upload them here.
              </p>
            </div>
          ) : view === "grid" ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {files.map((file) => (
                <li key={file.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
                  <button type="button" onClick={() => void openFile(file.id)} className="block aspect-[4/3] w-full bg-slate-50 dark:bg-slate-800" aria-label={`Open ${file.filename}`}>
                    {(() => {
                      const placeholder = (
                        <span className="flex h-full w-full flex-col items-center justify-center gap-2 text-blue-600 dark:text-blue-300">
                          <FileIcon file={file} size={30} />
                          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold dark:bg-blue-950">{typeLabel(file)}</span>
                        </span>
                      );
                      return file.kind === "image" ? (
                        <StoredImage src={file.url} alt={file.filename} className="h-full w-full object-cover" fallback={placeholder} />
                      ) : (
                        placeholder
                      );
                    })()}
                  </button>
                  <div className="p-3">
                    <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100" title={file.filename}>
                      {file.filename}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                      <SourceIcon source={file.source} /> {SOURCE_LABELS[file.source]} · {formatBytes(file.size_bytes)} · {formatShortDate(file.created_at)}
                    </p>
                    <FileActions file={file} onDelete={() => setToDelete(file)} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {files.map((file) => (
                <li key={file.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-blue-600 dark:bg-slate-800 dark:text-blue-300">
                    {file.kind === "image" ? (
                      <StoredImage src={file.url} alt="" className="h-full w-full object-cover" fallback={<FileIcon file={file} size={18} />} />
                    ) : (
                      <FileIcon file={file} size={18} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => void openFile(file.id)} className="block max-w-full truncate text-left text-sm font-semibold text-slate-800 hover:underline dark:text-slate-100">
                      {file.filename}
                    </button>
                    <p className="flex items-center gap-1 text-[11px] text-slate-500">
                      <span className="rounded bg-slate-100 px-1.5 font-bold dark:bg-slate-800">{typeLabel(file)}</span>
                      <SourceIcon source={file.source} /> {SOURCE_LABELS[file.source]} · {formatBytes(file.size_bytes)} · {formatShortDate(file.created_at)}
                    </p>
                  </div>
                  <FileActions file={file} onDelete={() => setToDelete(file)} compact />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {toDelete && (
        <ConfirmDialog
          title="Delete file?"
          description={`"${toDelete.filename}" will be permanently deleted from your Library. Messages that referenced it will no longer show it.`}
          confirmLabel="Delete"
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            try {
              await generalWorkApi.deleteFile(toDelete.id);
              setFiles((current) => current.filter((file) => file.id !== toDelete.id));
              toast.success("File deleted.");
              setToDelete(null);
            } catch (err) {
              toast.error(describeApiError(err, "Couldn't delete the file."));
            }
          }}
        />
      )}
    </div>
  );
}

function FileActions({ file, onDelete, compact }: { file: GeneralWorkFile; onDelete: () => void; compact?: boolean }) {
  const button = "rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-white";
  return (
    <div className={`flex items-center gap-0.5 ${compact ? "" : "mt-2 -ml-1.5"}`}>
      <button type="button" onClick={() => void openFile(file.id)} className={button} aria-label={`Open ${file.filename}`} title="Open">
        <ExternalLink size={14} />
      </button>
      <button type="button" onClick={() => void downloadFile(file.id)} className={button} aria-label={`Download ${file.filename}`} title="Download">
        <Download size={14} />
      </button>
      <button type="button" onClick={onDelete} className={`${button} hover:text-rose-600`} aria-label={`Delete ${file.filename}`} title="Delete">
        <Trash2 size={14} />
      </button>
    </div>
  );
}
