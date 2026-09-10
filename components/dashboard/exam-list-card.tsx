"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CalendarDays, Clock3, Copy, UsersRound } from "lucide-react";
import type { Exam } from "@/lib/types/domain";
import { formatDate, toPersianNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTeacherExamStore } from "@/lib/state/teacher-exam-store";
import { useToastStore } from "@/lib/state/toast-store";

const statusMap = {
  active: ["در حال برگزاری", "success"],
  scheduled: ["زمان‌بندی شده", "default"],
  completed: ["پایان یافته", "neutral"],
  draft: ["پیش‌نویس", "warning"],
  archived: ["بایگانی", "neutral"],
} as const;

export function ExamListCard({ exam, role = "student" }: { exam: Exam; role?: "student" | "teacher" }) {
  const toast = useToastStore((state) => state.push);
  const duplicateExam = useTeacherExamStore((state) => state.duplicateExam);
  const [duplicating, setDuplicating] = useState(false);
  const [label, variant] = statusMap[exam.status];
  const href = role === "student" ? (exam.status === "active" ? `/student/exam/${exam.id}` : "/student/dashboard") : `/teacher/exams/${exam.id}`;

  async function duplicate() {
    setDuplicating(true);
    try {
      const copy = await duplicateExam(exam.id);
      toast(copy
        ? { title: "کپی آزمون ساخته شد", description: `«${copy.title}» به‌عنوان پیش‌نویس در فهرست شماست.`, variant: "success" }
        : { title: "تکثیر آزمون انجام نشد", description: "اتصال خود را بررسی کنید و دوباره تلاش کنید.", variant: "error" });
    } finally {
      setDuplicating(false);
    }
  }

  return (
    <Card className="group overflow-hidden p-0 transition-all hover:-translate-y-0.5 hover:shadow-lift">
      <div className="flex">
        <div className={`w-1.5 ${exam.accent === "teal" ? "bg-teal-500" : exam.accent === "violet" ? "bg-violet-500" : exam.accent === "amber" ? "bg-amber-500" : "bg-primary"}`}/>
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><Badge variant={variant}>{label}</Badge><span className="text-[11px] font-bold text-muted-foreground">{exam.subject}</span></div>
              <h3 className="mt-2 truncate text-sm font-black sm:text-base">{exam.title}</h3>
            </div>
            {role === "teacher" && <Button type="button" variant="ghost" size="icon-sm" aria-label="تکثیر آزمون به‌عنوان پیش‌نویس" title="تکثیر آزمون" onClick={() => void duplicate()} disabled={duplicating}><Copy className={duplicating ? "h-4 w-4 animate-pulse" : "h-4 w-4"}/></Button>}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-bold text-muted-foreground">
            <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5"/>{formatDate(exam.startAt)}</span>
            <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5"/>{toPersianNumber(exam.settings.durationMinutes)} دقیقه</span>
            {role === "teacher" && <span className="flex items-center gap-1.5"><UsersRound className="h-3.5 w-3.5"/>{toPersianNumber(exam.participantCount)} شرکت‌کننده · {toPersianNumber(exam.attemptCount ?? 0)} تلاش</span>}
          </div>
          <div className="mt-4 flex justify-end">
            <Button asChild variant="ghost" size="sm"><Link href={href}>{role === "student" && exam.status === "active" ? "شروع آزمون" : "مشاهده جزئیات"}<ArrowLeft className="h-3.5 w-3.5"/></Link></Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
