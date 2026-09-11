"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "examora.attempt-session";

/**
 * One random identity per browser tab for the length of an attempt.
 *
 * sessionStorage (not localStorage) is the whole trick: it survives a refresh or a crash in the same
 * tab, so "resume in this window" stays true, while a duplicated tab or another device gets a different
 * id and the server can tell them apart. Nothing here is trusted for time or permission — it only names
 * the writer, and the server decides who owns the attempt.
 */
function readSession(): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    const created = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 64);
    window.sessionStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // Private-mode or disabled storage: writes simply go unguarded instead of failing the exam.
    return "";
  }
}

export function useExamSession(active: boolean) {
  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    if (!active) return;
    setSessionId(readSession());
  }, [active]);
  return sessionId;
}
