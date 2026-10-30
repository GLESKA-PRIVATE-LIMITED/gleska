"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Camera, FileText, ImageIcon, Loader2, Plus, Square, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { VoiceMicIcon } from "@/components/ui/VoiceMicIcon";
import { UPLOAD_RULES, describeApiError, formatBytes, generalWorkApi, type GeneralWorkFile } from "@/lib/general-work-api";
import { useSpeechInput } from "@/lib/useSpeechInput";
import CameraCaptureDialog from "./CameraCaptureDialog";
import { useAttachmentUploads, type PendingAttachment } from "./useAttachmentUploads";

interface ChatComposerProps {
  /** Resolves true when the message was accepted so the composer can clear itself. */
  onSend: (content: string, files: GeneralWorkFile[]) => Promise<boolean>;
  sending: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

const MAX_TEXTAREA_HEIGHT = 220;

function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function transcribeAudio(audio: Blob): Promise<string> {
  try {
    return await generalWorkApi.transcribe(audio);
  } catch (error) {
    throw new Error(describeApiError(error, "Transcription failed. Please try again."));
  }
}

export default function ChatComposer({ onSend, sending, placeholder = "Ask anything", autoFocus }: ChatComposerProps) {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);

  const showError = useCallback((message: string) => toast.error(message), []);
  const uploads = useAttachmentUploads(showError);

  const appendTranscript = useCallback((transcript: string) => {
    setText((current) => (current.trim() ? `${current.replace(/\s+$/, "")} ${transcript}` : transcript));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const voice = useSpeechInput({ onTranscript: appendTranscript, transcribe: transcribeAudio });

  const { error: voiceError, clearError: clearVoiceError } = voice;
  useEffect(() => {
    if (voiceError) {
      toast.error(voiceError);
      clearVoiceError();
    }
  }, [voiceError, clearVoiceError]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [text]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const canSend =
    !sending &&
    !uploads.isUploading &&
    !uploads.hasErrors &&
    voice.status !== "transcribing" &&
    (text.trim().length > 0 || uploads.readyFiles.length > 0);

  const submit = async () => {
    if (!canSend || submittingRef.current) return;
    submittingRef.current = true;
    if (voice.isListening) voice.stop();
    const content = text.trim();
    const files = uploads.readyFiles;
    try {
      const accepted = await onSend(content, files);
      if (accepted) {
        setText("");
        uploads.clearSent();
      }
    } finally {
      submittingRef.current = false;
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const pickFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length) uploads.addFiles(files, "upload");
  };

  return (
    <div className="w-full">
      <div className="rounded-[28px] border border-slate-200 bg-white p-2 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.18)] transition focus-within:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-600">
        {uploads.attachments.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-2 pb-2 pt-1">
            {uploads.attachments.map((attachment) => (
              <AttachmentChip key={attachment.localId} attachment={attachment} onRemove={() => uploads.remove(attachment.localId)} />
            ))}
          </div>
        )}

        {voice.isListening && (
          <div className="mx-2 mb-1 flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" role="status">
            <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
            Listening… {formatDuration(voice.elapsedSeconds)}
            {voice.interimText && <span className="truncate italic text-rose-500/80">{voice.interimText}</span>}
          </div>
        )}
        {voice.status === "transcribing" && (
          <div className="mx-2 mb-1 flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500" role="status">
            <Loader2 size={12} className="animate-spin" /> Transcribing…
          </div>
        )}

        <div className="flex items-end gap-1.5">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Add photos and files"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Plus size={20} />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute bottom-12 left-0 z-30 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <AttachMenuItem icon={ImageIcon} label="Upload images" onClick={() => { setMenuOpen(false); imageInputRef.current?.click(); }} />
                <AttachMenuItem icon={FileText} label="Upload files" onClick={() => { setMenuOpen(false); fileInputRef.current?.click(); }} />
                <AttachMenuItem icon={Camera} label="Take photo" onClick={() => { setMenuOpen(false); setCameraOpen(true); }} />
              </div>
            )}
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={placeholder}
            aria-label="Message Gleska AI"
            autoFocus={autoFocus}
            className="max-h-[220px] min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-6 text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
          />

          <button
            type="button"
            onClick={voice.isListening ? voice.stop : voice.start}
            disabled={!voice.isSupported || voice.status === "transcribing" || sending}
            title={voice.isSupported ? (voice.isListening ? "Stop recording" : "Voice input") : "Voice input isn't supported in this browser"}
            aria-label={voice.isListening ? "Stop voice input" : "Start voice input"}
            aria-pressed={voice.isListening}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
              voice.isListening
                ? "bg-rose-500 text-white hover:bg-rose-600"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {voice.isListening ? <Square size={14} fill="currentColor" /> : <VoiceMicIcon className="h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSend}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={19} strokeWidth={2.5} />}
          </button>
        </div>
      </div>

      <input ref={imageInputRef} type="file" accept={UPLOAD_RULES.image.accept} multiple className="hidden" onChange={pickFiles} />
      <input ref={fileInputRef} type="file" accept={UPLOAD_RULES.document.accept} multiple className="hidden" onChange={pickFiles} />
      {cameraOpen && (
        <CameraCaptureDialog onCapture={(file) => uploads.addFiles([file], "camera")} onClose={() => setCameraOpen(false)} />
      )}
    </div>
  );
}

function AttachMenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      <Icon size={17} className="text-slate-500" />
      {label}
    </button>
  );
}

function AttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
  const isError = attachment.status === "error";
  return (
    <div
      className={`relative flex w-52 shrink-0 items-center gap-2 rounded-2xl border p-2 ${
        isError ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40" : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
      }`}
    >
      {attachment.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
        <img src={attachment.previewUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
          <FileText size={18} />
        </div>
      )}
      <div className="min-w-0 flex-1 pr-4">
        <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100" title={attachment.filename}>
          {attachment.filename}
        </p>
        {isError ? (
          <p className="flex items-center gap-1 truncate text-[11px] text-rose-600 dark:text-rose-400" title={attachment.error}>
            <AlertCircle size={11} /> {attachment.error}
          </p>
        ) : attachment.status === "uploading" ? (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-label="Upload progress">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.round(attachment.progress * 100)}%` }} />
          </div>
        ) : (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{formatBytes(attachment.sizeBytes)}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 rounded-full bg-white p-0.5 text-slate-500 shadow-sm hover:text-slate-800 dark:bg-slate-900 dark:text-slate-400"
        aria-label={`Remove ${attachment.filename}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}
