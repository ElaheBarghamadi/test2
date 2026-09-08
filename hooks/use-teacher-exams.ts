"use client";
import { useEffect } from "react";
import { useTeacherExamStore } from "@/lib/state/teacher-exam-store";

/** Binds existing teacher UI to the server-backed exam store. */
export function useTeacherExams() {
  const state = useTeacherExamStore();
  useEffect(() => { void state.hydrate(); }, [state.hydrate]);
  return state;
}
