"use client";

// Reusable voice-to-text hook.
// Prefers the browser Web Speech API (live transcription, Chrome/Edge/Safari). When that is
// unavailable but microphone recording is (e.g. Firefox), it records audio with MediaRecorder
// and hands the clip to `transcribe` for server-side speech-to-text.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type SpeechInputMode = "speech-recognition" | "recording" | "unsupported";
export type SpeechInputStatus = "idle" | "listening" | "transcribing";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const MAX_RECORDING_MS = 2 * 60 * 1000;

const subscribeToNothing = () => () => undefined;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function detectMode(canTranscribe: boolean): SpeechInputMode {
  if (typeof window === "undefined") return "unsupported";
  if (getSpeechRecognition()) return "speech-recognition";
  if (canTranscribe && typeof MediaRecorder !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
    return "recording";
  }
  return "unsupported";
}

function pickRecordingMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function describeError(error: string): string {
  if (error === "not-allowed" || error === "NotAllowedError" || error === "service-not-allowed") {
    return "Microphone access was blocked. Allow microphone access in your browser settings and try again.";
  }
  if (error === "audio-capture" || error === "NotFoundError") return "No microphone was found on this device.";
  if (error === "network") return "Speech recognition needs an internet connection.";
  if (error === "no-speech") return "No speech was detected. Please try again.";
  return "Voice input stopped unexpectedly. Please try again.";
}

export interface UseSpeechInputOptions {
  /** Called with each piece of final transcribed text. */
  onTranscript: (text: string) => void;
  /** Server-side transcription used when the Web Speech API is unavailable. */
  transcribe?: (audio: Blob) => Promise<string>;
  lang?: string;
}

export function useSpeechInput({ onTranscript, transcribe, lang = "en-IN" }: UseSpeechInputOptions) {
  // Browser capabilities don't change, so there is nothing to subscribe to; the server snapshot
  // ("unsupported") keeps the first client render identical to the server-rendered HTML.
  const mode = useSyncExternalStore(
    subscribeToNothing,
    () => detectMode(Boolean(transcribe)),
    () => "unsupported" as const,
  );
  const [status, setStatus] = useState<SpeechInputStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const transcribeRef = useRef(transcribe);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    transcribeRef.current = transcribe;
  }, [onTranscript, transcribe]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    timerRef.current = null;
    autoStopRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, [clearTimers]);

  const startTimer = useCallback(() => {
    const startedAt = Date.now();
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    autoStopRef.current = setTimeout(() => stop(), MAX_RECORDING_MS);
  }, [stop]);

  const startRecognition = useCallback(() => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          if (text.trim()) onTranscriptRef.current(text.trim());
        } else {
          interim += text;
        }
      }
      setInterimText(interim);
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted") setError(describeError(event.error));
    };
    recognition.onend = () => {
      clearTimers();
      recognitionRef.current = null;
      setInterimText("");
      setStatus("idle");
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setStatus("listening");
      startTimer();
    } catch {
      recognitionRef.current = null;
      setError(describeError("start-failed"));
    }
  }, [clearTimers, lang, startTimer]);

  const startRecording = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(describeError((err as DOMException)?.name || "unknown"));
      return;
    }
    streamRef.current = stream;
    const mimeType = pickRecordingMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      clearTimers();
      releaseStream();
      recorderRef.current = null;
      const audio = new Blob(chunks, { type: (recorder.mimeType || mimeType || "audio/webm").split(";")[0] });
      if (!audio.size || !transcribeRef.current) {
        setStatus("idle");
        return;
      }
      setStatus("transcribing");
      try {
        const text = await transcribeRef.current(audio);
        if (text.trim()) onTranscriptRef.current(text.trim());
        else setError(describeError("no-speech"));
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : "Transcription failed. Please try again.");
      } finally {
        setStatus("idle");
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setStatus("listening");
    startTimer();
  }, [clearTimers, releaseStream, startTimer]);

  const start = useCallback(() => {
    if (status !== "idle") return;
    setError(null);
    setInterimText("");
    if (mode === "speech-recognition") startRecognition();
    else if (mode === "recording") void startRecording();
    else setError("Voice input isn't supported in this browser.");
  }, [mode, startRecognition, startRecording, status]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => () => {
    clearTimers();
    recognitionRef.current?.abort();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    releaseStream();
  }, [clearTimers, releaseStream]);

  return {
    mode,
    isSupported: mode !== "unsupported",
    status,
    isListening: status === "listening",
    elapsedSeconds,
    interimText,
    error,
    clearError,
    start,
    stop,
  };
}
