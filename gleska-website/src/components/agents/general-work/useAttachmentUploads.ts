"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  UPLOAD_RULES,
  describeApiError,
  formatBytes,
  generalWorkApi,
  type GeneralWorkFile,
  type GeneralWorkFileKind,
} from "@/lib/general-work-api";

export interface PendingAttachment {
  localId: string;
  filename: string;
  sizeBytes: number;
  kind: GeneralWorkFileKind;
  previewUrl: string | null;
  progress: number;
  status: "uploading" | "ready" | "error";
  error?: string;
  file?: GeneralWorkFile;
}

function extensionOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

export function classifyFile(file: File): { kind: GeneralWorkFileKind } | { error: string } {
  const ext = extensionOf(file.name);
  for (const kind of ["image", "document"] as const) {
    const rule = UPLOAD_RULES[kind];
    if ((rule.extensions as readonly string[]).includes(ext)) {
      if (file.size === 0) return { error: `${file.name} is empty.` };
      if (file.size > rule.maxBytes) {
        return { error: `${file.name} is larger than ${formatBytes(rule.maxBytes)}.` };
      }
      return { kind };
    }
  }
  return { error: `${file.name} isn't a supported file type.` };
}

export function useAttachmentUploads(onError: (message: string) => void) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const attachmentsRef = useRef(attachments);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const update = useCallback((localId: string, changes: Partial<PendingAttachment>) => {
    setAttachments((current) => current.map((item) => (item.localId === localId ? { ...item, ...changes } : item)));
  }, []);

  const addFiles = useCallback(
    (files: File[], source: "upload" | "camera" = "upload") => {
      const slots = MAX_ATTACHMENTS_PER_MESSAGE - attachmentsRef.current.length;
      if (slots <= 0) {
        onError(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
        return;
      }
      if (files.length > slots) onError(`Only ${slots} more file(s) can be attached to this message.`);

      for (const file of files.slice(0, slots)) {
        const result = classifyFile(file);
        if ("error" in result) {
          onError(result.error);
          continue;
        }
        const localId = crypto.randomUUID();
        const controller = new AbortController();
        controllers.current.set(localId, controller);
        const pending: PendingAttachment = {
          localId,
          filename: file.name,
          sizeBytes: file.size,
          kind: result.kind,
          previewUrl: result.kind === "image" ? URL.createObjectURL(file) : null,
          progress: 0,
          status: "uploading",
        };
        setAttachments((current) => [...current, pending]);

        generalWorkApi
          .uploadFile(file, file.name, source, (fraction) => update(localId, { progress: fraction }), controller.signal)
          .then((uploaded) => update(localId, { status: "ready", progress: 1, file: uploaded }))
          .catch((error) => {
            if (controller.signal.aborted) return;
            update(localId, { status: "error", error: describeApiError(error, "Upload failed.") });
          })
          .finally(() => controllers.current.delete(localId));
      }
    },
    [onError, update],
  );

  const remove = useCallback((localId: string) => {
    const item = attachmentsRef.current.find((attachment) => attachment.localId === localId);
    controllers.current.get(localId)?.abort();
    controllers.current.delete(localId);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    // A file removed before sending was never used, so it is deleted rather than left in the Library.
    if (item?.file) void generalWorkApi.deleteFile(item.file.id).catch(() => undefined);
    setAttachments((current) => current.filter((attachment) => attachment.localId !== localId));
  }, []);

  /** Called after a successful send: the files now belong to the message, so only local state is cleared. */
  const clearSent = useCallback(() => {
    attachmentsRef.current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    setAttachments([]);
  }, []);

  useEffect(() => {
    const activeControllers = controllers.current;
    return () => {
      activeControllers.forEach((controller) => controller.abort());
      attachmentsRef.current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  return {
    attachments,
    addFiles,
    remove,
    clearSent,
    isUploading: attachments.some((item) => item.status === "uploading"),
    hasErrors: attachments.some((item) => item.status === "error"),
    readyFiles: attachments.filter((item) => item.status === "ready" && item.file).map((item) => item.file!),
  };
}
