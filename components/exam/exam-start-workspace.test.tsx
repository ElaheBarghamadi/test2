import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExamStartWorkspace } from "@/components/exam/exam-start-workspace";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import type { Exam } from "@/lib/types/domain";

/** Exactly what `toStudentDashboardExam` produces before an attempt exists: no question bodies. */
function previewExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: "exam-1", title: "آزمون شیمی", description: "فصل سوم", subject: "شیمی", grade: "۱۲", className: "۲",
    status: "active", startAt: "2026-03-20T05:30:00Z", endAt: "2026-03-20T07:30:00Z",
    schedule: { startAt: "2026-03-20T05:30:00Z", endAt: "2026-03-20T07:30:00Z", timezone: "Asia/Tehran" },
    questionCount: 5, participantCount: 0, teacherName: "الاهه برغمدی", accent: "indigo",
    createdAt: "2026-03-01T05:30:00Z", updatedAt: "2026-03-01T05:30:00Z",
    settings: { durationMinutes: 45, totalMarks: 10, allowBackNavigation: true, questionLayout: "paged", randomizeQuestions: false, randomizeOptions: false, allowUnanswered: true, showResultImmediately: false, resultVisibility: "pending", showCorrectAnswers: false, attemptLimit: 2, passingPercentage: 50 },
    questions: [], availability: "available", attemptsUsed: 0,
    ...overrides,
  };
}

const startButton = () => screen.getByRole("button", { name: /شروع آزمون/ }) as HTMLButtonElement;

describe("ExamStartWorkspace gating", () => {
  it("lets the student start while the question list is still server-side only", () => {
    useExamAttemptStore.setState({ attempt: null });
    render(<ExamStartWorkspace exam={previewExam()} remote/>);
    expect(startButton().disabled).toBe(false);
    expect(screen.getByText(/۵ سؤال/)).toBeTruthy();
    expect(screen.getByText(/به‌صورت خودکار در طول آزمون ذخیره می‌شوند/)).toBeTruthy();
  });

  it("shows the marks, pass mark and attempt budget the server reported", () => {
    useExamAttemptStore.setState({ attempt: null });
    render(<ExamStartWorkspace exam={previewExam()} remote/>);
    expect(screen.getByText("کل نمره")).toBeTruthy();
    expect(screen.getByText("۱۰ نمره")).toBeTruthy();
    expect(screen.getByText("حداقل نمرهٔ قبولی")).toBeTruthy();
    expect(screen.getByText("۵۰٪")).toBeTruthy();
    expect(screen.getByText("تلاش باقی‌مانده")).toBeTruthy();
    expect(screen.getByText("۲ از ۲")).toBeTruthy();
    expect(screen.getByText(/۲ تلاش مجاز دارید/)).toBeTruthy();
    expect(screen.getByText(/نتیجه پس از بررسی و انتشار معلم/)).toBeTruthy();
  });

  it("refuses to start once the attempt budget is spent, before the server has to", () => {
    useExamAttemptStore.setState({ attempt: null });
    render(<ExamStartWorkspace exam={previewExam({ attemptsUsed: 2, availability: "completed" })} remote/>);
    expect(startButton().disabled).toBe(true);
    expect(screen.getAllByText(/تعداد تلاش‌های مجاز شما به پایان رسیده است/).length).toBeGreaterThan(0);
    expect(screen.getByText("۰ از ۲")).toBeTruthy();
  });

  it("keeps a scheduled exam closed until its window opens", () => {
    useExamAttemptStore.setState({ attempt: null });
    render(<ExamStartWorkspace exam={previewExam({ status: "scheduled", availability: "upcoming" })} remote/>);
    expect(startButton().disabled).toBe(true);
    expect(screen.getAllByText(/اکنون در حالت برگزاری نیست/).length).toBeGreaterThan(0);
  });

  it("goes back on a paged exam instead of claiming every skipped question locks", () => {
    useExamAttemptStore.setState({ attempt: null });
    render(<ExamStartWorkspace exam={previewExam({ settings: { ...previewExam().settings, allowBackNavigation: true, questionLayout: "paged" } })} remote/>);
    // The old copy promised a lock that only exists when the teacher has turned navigation off.
    expect(screen.getByText(/می‌توانید به سؤال‌های قبل برگردید/)).toBeTruthy();
    expect(screen.queryByText(/سؤالِ ردشده قفل می‌شود/)).toBeNull();
  });

  it("states the no-return rule only when the teacher set it", () => {
    useExamAttemptStore.setState({ attempt: null });
    render(<ExamStartWorkspace exam={previewExam({ settings: { ...previewExam().settings, allowBackNavigation: false, questionLayout: "paged" } })} remote/>);
    expect(screen.getByText(/بازگشت به سؤال‌های قبل ممکن نیست و سؤالِ ردشده قفل می‌شود/)).toBeTruthy();
    expect(screen.getByText(/حتی با رفرش صفحه بازنمی‌گردد/)).toBeTruthy();
  });

  it("never mentions a lock on a one-page exam, where nothing can be locked", () => {
    useExamAttemptStore.setState({ attempt: null });
    render(<ExamStartWorkspace exam={previewExam({ settings: { ...previewExam().settings, allowBackNavigation: false, questionLayout: "single_page" } })} remote/>);
    expect(screen.getByText(/همهٔ سؤال‌ها در یک صفحه/)).toBeTruthy();
    expect(screen.queryByText(/قفل/)).toBeNull();
  });

  it("announces shuffled options only when the server says they are shuffled", () => {
    useExamAttemptStore.setState({ attempt: null });
    const { unmount } = render(<ExamStartWorkspace exam={previewExam()} remote/>);
    expect(screen.queryByText(/جابه‌جا می‌شود/)).toBeNull();
    unmount();
    render(<ExamStartWorkspace exam={previewExam({ settings: { ...previewExam().settings, randomizeQuestions: true, randomizeOptions: true } })} remote/>);
    expect(screen.getByText(/ترتیب سؤال‌ها برای هر دانش‌آموز به‌صورت تصادفی است/)).toBeTruthy();
    expect(screen.getByText(/گزینه‌های سؤال‌های چندگزینه‌ای هم برای هر دانش‌آموز جابه‌جا می‌شود/)).toBeTruthy();
  });

  it("does not offer an empty exam as startable", () => {
    useExamAttemptStore.setState({ attempt: null });
    render(<ExamStartWorkspace exam={previewExam({ questionCount: 0 })} remote/>);
    expect(startButton().disabled).toBe(true);
    expect(screen.getAllByText(/هنوز سؤالی ندارد/).length).toBeGreaterThan(0);
  });
});
