import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving an exam, while other screens are watching the same store.
 *
 * Two things went wrong here in practice. A second tap (or Ctrl+S pressed while the first tap was still in
 * flight) sent a second write, and the second write created a *copy* of an exam that already existed. And the
 * save flipped the store-wide `loading` flag, which every screen that shows the exam list reads - so saving a
 * draft made the list behind it look like it was reloading, and made the builder's own "is this exam loaded?"
 * guard flash a skeleton mid-save.
 */
const service = vi.hoisted(() => ({
  getExams: vi.fn(),
  getExam: vi.fn(),
  createExam: vi.fn(),
  updateExam: vi.fn(),
  duplicateExam: vi.fn(),
  startExam: vi.fn(),
  extendExam: vi.fn(),
  completeExam: vi.fn(),
  archiveExam: vi.fn(),
  restoreExam: vi.fn(),
}));

vi.mock("@/lib/services/teacher-exam-service", () => ({ teacherExamService: service }));

import { useTeacherExamStore } from "@/lib/state/teacher-exam-store";
import type { Exam, ExamDraft } from "@/lib/types/domain";

function exam(id: string): Exam {
  return {
    id, title: "آزمون", description: "", subject: "ریاضی", grade: "دوازدهم", className: "۱",
    status: "draft", startAt: "", endAt: "", schedule: { startAt: "", endAt: "", timezone: "Asia/Tehran" },
    questionCount: 0, participantCount: 0, questions: [], createdAt: "", updatedAt: "",
  } as unknown as Exam;
}

const draft = { title: "آزمون فصل ۱", questions: [], settings: {}, schedule: {} } as unknown as ExamDraft;

/** A promise the test resolves by hand, so "in flight" is a state the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset());
  useTeacherExamStore.setState({ exams: [], loading: false, saving: false, detailLoadingId: null, initialized: true, error: null });
});

describe("saving an exam", () => {
  it("runs one write no matter how many callers ask for it", async () => {
    const pending = deferred<Exam>();
    service.createExam.mockReturnValue(pending.promise);

    const first = useTeacherExamStore.getState().saveExam(draft, "draft");
    const second = useTeacherExamStore.getState().saveExam(draft, "draft");

    expect(service.createExam).toHaveBeenCalledTimes(1);
    expect(useTeacherExamStore.getState().saving).toBe(true);

    pending.resolve(exam("exam-1"));
    const [a, b] = await Promise.all([first, second]);
    expect(a.id).toBe("exam-1");
    expect(b.id).toBe("exam-1");
    expect(useTeacherExamStore.getState().saving).toBe(false);
  });

  it("leaves the list's own loading flag alone", async () => {
    const pending = deferred<Exam>();
    service.createExam.mockReturnValue(pending.promise);

    const saving = useTeacherExamStore.getState().saveExam(draft, "draft");
    // A save is not a reload: the table behind the form must keep showing its rows.
    expect(useTeacherExamStore.getState().loading).toBe(false);

    pending.resolve(exam("exam-1"));
    await saving;
    expect(useTeacherExamStore.getState().loading).toBe(false);
  });

  it("lets the next save through once the first one is done", async () => {
    service.createExam.mockResolvedValueOnce(exam("exam-1"));
    service.updateExam.mockResolvedValueOnce(exam("exam-1"));

    await useTeacherExamStore.getState().saveExam(draft, "draft");
    // The second save carries the id the server handed back, so it is an update, not a second copy.
    await useTeacherExamStore.getState().saveExam({ ...draft, id: "exam-1" } as ExamDraft, "draft");

    expect(service.createExam).toHaveBeenCalledTimes(1);
    expect(service.updateExam).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight latch after a failure so a retry can be attempted", async () => {
    service.createExam.mockRejectedValueOnce(new Error("اتصال به سرور برقرار نشد."));

    await expect(useTeacherExamStore.getState().saveExam(draft, "draft")).rejects.toThrow();
    expect(useTeacherExamStore.getState().saving).toBe(false);
    expect(useTeacherExamStore.getState().error).toContain("برقرار نشد");

    service.createExam.mockResolvedValueOnce(exam("exam-1"));
    await expect(useTeacherExamStore.getState().saveExam(draft, "draft")).resolves.toMatchObject({ id: "exam-1" });
    expect(service.createExam).toHaveBeenCalledTimes(2);
  });
});
