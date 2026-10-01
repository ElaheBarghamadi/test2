"use client";

import { create } from "zustand";
import { apiErrorMessage } from "@/lib/api/client";
import { teacherExamService } from "@/lib/services/teacher-exam-service";
import type { Exam, ExamDraft } from "@/lib/types/domain";

interface TeacherExamState {
  exams: Exam[];
  /** The list is being fetched. A save deliberately does *not* set this: it made every screen that shows the
   *  list (and the builder that guards on it) look like it was loading while an unrelated save was in flight. */
  loading: boolean;
  /** A save is in flight, whichever button started it. */
  saving: boolean;
  detailLoadingId: string | null;
  initialized: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  loadExam: (id: string) => Promise<Exam | undefined>;
  saveExam: (draft: ExamDraft, status: "draft" | "scheduled") => Promise<Exam>;
  duplicateExam: (id: string) => Promise<Exam | undefined>;
  startExam: (id: string) => Promise<Exam | undefined>;
  extendExam: (id: string, extraMinutes: number) => Promise<Exam | undefined>;
  completeExam: (id: string) => Promise<void>;
  archiveExam: (id: string) => Promise<void>;
  restoreExam: (id: string) => Promise<void>;
  clearError: () => void;
}

const mergeExam = (exams: Exam[], saved: Exam) => exams.some((exam) => exam.id === saved.id) ? exams.map((exam) => exam.id === saved.id ? saved : exam) : [saved, ...exams];

/**
 * One save at a time, and every caller of that save gets the same answer.
 *
 * Two buttons that both call `saveExam` (the publish button and Ctrl+S, a double tap on a slow phone) used to
 * send two writes: the first creates the exam, the second creates a *second* copy of it with the same
 * client-side question ids, and the teacher ends up with two half-populated papers. The guard lives here
 * rather than in each button so no screen has to remember it.
 */
let saveInFlight: Promise<Exam> | null = null;

export const useTeacherExamStore = create<TeacherExamState>((set, get) => ({
  exams: [], loading: false, saving: false, detailLoadingId: null, initialized: false, error: null,
  hydrate: async () => {
    if (get().initialized || get().loading) return;
    set({ loading: true, error: null });
    try { set({ exams: await teacherExamService.getExams(), initialized: true, loading: false }); }
    catch (error) { set({ loading: false, error: apiErrorMessage(error, "بارگذاری آزمون‌ها انجام نشد. لطفاً دوباره تلاش کنید.") }); }
  },
  loadExam: async (id) => {
    if (get().detailLoadingId === id) return undefined;
    set({ detailLoadingId: id, error: null });
    try {
      const exam = await teacherExamService.getExam(id);
      set((state) => ({ exams: mergeExam(state.exams, exam), detailLoadingId: null }));
      return exam;
    } catch (error) {
      set({ detailLoadingId: null, error: apiErrorMessage(error, "بارگذاری جزئیات آزمون انجام نشد.") });
      return undefined;
    }
  },
  saveExam: async (draft, status) => {
    if (saveInFlight) return saveInFlight;
    const run = (async () => {
      set({ saving: true, error: null });
      try {
        const saved = draft.id
          ? await teacherExamService.updateExam(draft.id, draft, status === "scheduled")
          : await teacherExamService.createExam(draft, status === "scheduled");
        set((state) => ({ exams: mergeExam(state.exams, saved), saving: false }));
        return saved;
      } catch (error) {
        const message = apiErrorMessage(error, status === "scheduled" ? "انتشار آزمون انجام نشد. دوباره تلاش کنید." : "ذخیرهٔ پیش‌نویس انجام نشد. دوباره تلاش کنید.");
        set({ saving: false, error: message });
        throw new Error(message);
      } finally {
        saveInFlight = null;
      }
    })();
    saveInFlight = run;
    return run;
  },
  duplicateExam: async (id) => {
    set({ loading: true, error: null });
    try { const copy = await teacherExamService.duplicateExam(id); set((state) => ({ exams: [copy, ...state.exams], loading: false })); return copy; }
    catch (error) { set({ loading: false, error: apiErrorMessage(error, "ساخت کپی آزمون انجام نشد.") }); return undefined; }
  },
  startExam: async (id) => {
    set({ loading: true, error: null });
    try { const exam = await teacherExamService.startExam(id); set((state) => ({ exams: mergeExam(state.exams, exam), loading: false })); return exam; }
    catch (error) { set({ loading: false, error: apiErrorMessage(error, "شروع آزمون انجام نشد. لطفاً دوباره تلاش کنید.") }); return undefined; }
  },
  extendExam: async (id, extraMinutes) => {
    set({ loading: true, error: null });
    try { const exam = await teacherExamService.extendExam(id, extraMinutes); set((state) => ({ exams: mergeExam(state.exams, exam), loading: false })); return exam; }
    catch (error) { set({ loading: false, error: apiErrorMessage(error, "تمدید زمان آزمون انجام نشد. لطفاً دوباره تلاش کنید.") }); return undefined; }
  },
  completeExam: async (id) => {
    set({ loading: true, error: null });
    try { const exam = await teacherExamService.completeExam(id); set((state) => ({ exams: mergeExam(state.exams, exam), loading: false })); }
    catch (error) { set({ loading: false, error: apiErrorMessage(error, "پایان آزمون انجام نشد. لطفاً دوباره تلاش کنید.") }); }
  },
  archiveExam: async (id) => {
    set({ loading: true, error: null });
    try { const exam = await teacherExamService.archiveExam(id); set((state) => ({ exams: mergeExam(state.exams, exam), loading: false })); }
    catch (error) { set({ loading: false, error: apiErrorMessage(error, "بایگانی آزمون انجام نشد.") }); }
  },
  restoreExam: async (id) => {
    set({ loading: true, error: null });
    try { const exam = await teacherExamService.restoreExam(id); set((state) => ({ exams: mergeExam(state.exams, exam), loading: false })); }
    catch (error) { set({ loading: false, error: apiErrorMessage(error, "بازیابی آزمون انجام نشد.") }); }
  },
  clearError: () => set({ error: null }),
}));
