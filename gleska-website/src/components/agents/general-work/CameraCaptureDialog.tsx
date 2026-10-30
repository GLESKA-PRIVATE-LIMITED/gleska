"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Modal } from "./Dialogs";

interface CameraCaptureDialogProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

function cameraErrorMessage(error: unknown): string {
  const name = (error as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow camera access in your browser settings, or use your device camera instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is being used by another app.";
  return "The camera couldn't be started.";
}

export default function CameraCaptureDialog({ onCapture, onClose }: CameraCaptureDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [status, setStatus] = useState<"starting" | "live" | "captured" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<{ file: File; url: string } | null>(null);
  const liveCameraSupported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!liveCameraSupported || captured) return;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
        setStatus("live");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(cameraErrorMessage(err));
        setStatus("error");
      });
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [captured, facingMode, liveCameraSupported, stopStream]);

  useEffect(() => () => {
    if (captured) URL.revokeObjectURL(captured.url);
  }, [captured]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("The photo couldn't be captured. Please try again.");
          return;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const file = new File([blob], `photo-${stamp}.jpg`, { type: "image/jpeg" });
        stopStream();
        setCaptured({ file, url: URL.createObjectURL(blob) });
        setStatus("captured");
      },
      "image/jpeg",
      0.9,
    );
  };

  const close = () => {
    stopStream();
    onClose();
  };

  return (
    <Modal title="Take photo" description="The photo is attached to your message and saved to your Library." onClose={close}>
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-slate-900">
        {captured ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
          <img src={captured.url} alt="Captured photo preview" className="h-full w-full object-contain" />
        ) : liveCameraSupported && status !== "error" ? (
          <>
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
            {status === "starting" && <Loader2 size={28} className="absolute animate-spin text-white" />}
          </>
        ) : (
          <p className="px-6 text-center text-sm text-slate-200">
            {error || "Live camera preview isn't available in this browser."}
          </p>
        )}
      </div>

      <input
        ref={nativeInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            onCapture(file);
            close();
          }
        }}
      />

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {captured ? (
          <>
            <button
              type="button"
              onClick={() => {
                setCaptured(null);
                setStatus("starting");
              }}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RotateCcw size={14} /> Retake
            </button>
            <button
              type="button"
              onClick={() => {
                onCapture(captured.file);
                close();
              }}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Use photo
            </button>
          </>
        ) : status === "live" ? (
          <>
            <button
              type="button"
              onClick={() => {
                setStatus("starting");
                setFacingMode((mode) => (mode === "environment" ? "user" : "environment"));
              }}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Switch camera"
            >
              <RefreshCw size={14} /> Switch
            </button>
            <button
              type="button"
              onClick={capture}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Camera size={15} /> Capture
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => nativeInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Camera size={15} /> Use device camera
          </button>
        )}
      </div>
    </Modal>
  );
}
