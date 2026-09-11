"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { attemptsApi } from "@/lib/api/attempts";
import { apiErrorMessage } from "@/lib/api/client";
import { toStudentAttempt, toStudentDashboardExam } from "@/lib/api/mappers";
import { ExamReviewWorkspace } from "@/components/exam/exam-review-workspace";
import { ExamStartWorkspace } from "@/components/exam/exam-start-workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import { useExamSession } from "@/hooks/use-exam-session";
import type { Exam, ExamAttempt } from "@/lib/types/domain";

type Mode = "start" | "review";
type Session = { exam: Exam; attempt: ExamAttempt };

export function StudentExamSession({ examId, mode }: { examId: string; mode: Mode }) {
  const router = useRouter();
  const hydrateRemote = useExamAttemptStore((state) => state.hydrateRemote);
  const [preview, setPreview] = useState<Exam | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const examSession = useExamSession(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const available = await attemptsApi.listAvailable();
      const item = available.find((exam) => exam.id === examId);
      if (!item) { setError("این آزمون برای حساب شما در دسترس نیست یا پایان یافته است."); return; }
      setPreview(toStudentDashboardExam(item));
      if (item.attempt) {
        // Reading with this tab's identity is what lets a refresh re-establish ownership quietly: the
        // server only refuses *writes* from an unknown session, never a reload.
        const next = toStudentAttempt(await attemptsApi.detail(item.attempt.id, { examSession }));
        hydrateRemote(next.attempt); setSession(next);
      } else { setSession(null); }
    } catch (requestError) { setError(apiErrorMessage(requestError, "بارگذاری اطلاعات آزمون انجام نشد.")); }
    finally { setLoading(false); }
  }, [examId, examSession, hydrateRemote]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!loading && mode === "review" && !session && preview) router.replace(`/student/exam/${examId}`);
  }, [examId, loading, mode, preview, router, session]);

  const start = async () => {
    const next = toStudentAttempt(await attemptsApi.start(examId, { examSession }));
    hydrateRemote(next.attempt); setSession(next); setPreview(next.exam);
  };

  if (loading) return <Loading />;
  if (error || !preview) return <Unavailable error={error || "اطلاعات آزمون پیدا نشد."} retry={load}/>;
  if (mode === "review") return session ? <ExamReviewWorkspace exam={session.exam} remote/> : <Loading />;
  if (session) return <ExamStartWorkspace exam={session.exam} remote/>;
  return <ExamStartWorkspace exam={preview} remote onStart={start}/>;
}
function Loading() { return <div className="grid min-h-screen place-items-center bg-surface"><div className="flex items-center gap-3 text-sm font-bold text-muted-foreground"><span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"/>در حال دریافت آزمون…</div></div>; }
function Unavailable({ error, retry }: { error: string; retry: () => Promise<void> }) { return <div className="grid min-h-screen place-items-center bg-surface p-4"><Card className="w-full max-w-md"><CardContent className="p-8 text-center"><h1 className="text-lg font-black">دسترسی به آزمون ممکن نیست</h1><p role="alert" className="mt-3 text-sm leading-7 text-muted-foreground">{error}</p><div className="mt-6 flex justify-center gap-2"><Button variant="outline" onClick={() => void retry()}>تلاش دوباره</Button><Button asChild><a href="/student/dashboard">بازگشت به داشبورد</a></Button></div></CardContent></Card></div>; }
