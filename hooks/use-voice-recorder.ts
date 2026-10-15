"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecorderState = "idle" | "requesting" | "recording" | "stopping" | "denied" | "unsupported" | "error";

/**
 * Containers `MediaRecorder` can actually produce, best first.
 *
 * There is no single answer across browsers: Chrome and Firefox record `audio/webm`, Safari records
 * `audio/mp4` because it ships no WebM encoder. Picking by feature test rather than by user-agent string is
 * what keeps a spoken answer working on the tablet a school actually bought, and the server accepts both
 * containers (see `apps/core/secure_uploads.py`), so nothing here needs to transcode.
 */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

export function voiceRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

function extensionFor(mime: string): string {
  if (mime.startsWith("audio/mp4")) return "m4a";
  if (mime.startsWith("audio/ogg")) return "ogg";
  return "webm";
}

/**
 * A spoken answer, recorded in the page.
 *
 * Three things this hook is careful about, because a recording lost at the last step is worse than no
 * recording at all:
 *
 *   * the microphone stream is released on stop, on cancel and on unmount — a browser tab that keeps the
 *     recording light on after an exam is submitted reads as surveillance, whatever the code intended;
 *   * a hard cap stops the recorder by itself, so a student who walks away cannot fill the disk or produce a
 *     file the 15 MB upload limit would then refuse;
 *   * `denied` is a state of its own, not an error string, because "you pressed block" and "your browser has
 *     no microphone support" need different sentences and only one of them can be fixed by picking a file.
 */
export function useVoiceRecorder({
  maxSeconds = 180,
  onRecording,
}: {
  maxSeconds?: number;
  onRecording: (file: File) => void;
}) {
  const [state, setState] = useState<VoiceRecorderState>(voiceRecordingSupported() ? "idle" : "unsupported");
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeRef = useRef<string>("");
  const tickRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  // Read through refs inside async callbacks: `onRecording` is a fresh arrow function on every render of the
  // caller, and a stale one would upload into an unmounted component.
  const onRecordingRef = useRef(onRecording);
  useEffect(() => { onRecordingRef.current = onRecording; }, [onRecording]);
  const maxRef = useRef(maxSeconds);
  useEffect(() => { maxRef.current = maxSeconds; }, [maxSeconds]);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    clearTick();
    releaseStream();
    recorderRef.current = null;
    chunksRef.current = [];
    setSeconds(0);
  }, [clearTick, releaseStream]);

  useEffect(() => () => {
    // Unmount mid-recording: drop the mic, not just the UI.
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") {
      try { recorder.stop(); } catch { /* the device already closed it */ }
    }
    clearTick();
    releaseStream();
  }, [clearTick, releaseStream]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setState("stopping");
    try { recorder.stop(); } catch { teardown(); setState("idle"); }
  }, [teardown]);

  const start = useCallback(async () => {
    if (!voiceRecordingSupported()) { setState("unsupported"); return; }
    setMessage(null);
    cancelledRef.current = false;
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (reason) {
      const name = reason instanceof DOMException ? reason.name : "";
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      setMessage(name === "NotFoundError"
        ? "میکروفونی پیدا نشد. می‌توانید فایل صوتی را از دستگاه انتخاب کنید."
        : "دسترسی به میکروفون ممکن نشد. می‌توانید فایل صوتی را از دستگاه انتخاب کنید.");
      return;
    }
    streamRef.current = stream;
    const mime = pickMimeType();
    mimeRef.current = mime;
    chunksRef.current = [];
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mimeRef.current = recorder.mimeType || mime;
    } catch {
      teardown();
      setState("error");
      setMessage("مرورگر شما ضبط صدا را پشتیبانی نمی‌کند. فایل صوتی را از دستگاه انتخاب کنید.");
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => { if (event.data && event.data.size > 0) chunksRef.current.push(event.data); };
    recorder.onerror = () => {
      cancelledRef.current = true;
      teardown();
      setState("error");
      setMessage("ضبط صدا با خطا متوقف شد. دوباره تلاش کنید یا فایل صوتی بفرستید.");
    };
    recorder.onstop = () => {
      const cancelled = cancelledRef.current;
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
      teardown();
      if (cancelled) { setState("idle"); return; }
      if (blob.size === 0) {
        setState("error");
        setMessage("ضبط خالی بود. دوباره تلاش کنید.");
        return;
      }
      const extension = extensionFor(mimeRef.current);
      const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "-");
      setState("idle");
      onRecordingRef.current(new File([blob], `voice-${stamp}.${extension}`, { type: blob.type || "audio/webm" }));
    };

    recorder.start(250);
    setState("recording");
    setSeconds(0);
    tickRef.current = window.setInterval(() => {
      setSeconds((current) => {
        const next = current + 1;
        // Auto-stop at the cap rather than truncating the file afterwards: a student who forgets the recorder
        // is running should still get a complete, uploadable answer.
        if (next >= maxRef.current) stop();
        return next;
      });
    }, 1000);
  }, [stop, teardown]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stop();
  }, [stop]);

  return { state, seconds, message, start, stop, cancel, maxSeconds, supported: state !== "unsupported" };
}
