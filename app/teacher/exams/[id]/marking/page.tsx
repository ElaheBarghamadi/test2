import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { ExamMarkingWorkspace } from "@/components/teacher/exam-marking-workspace";

type Search = { [key: string]: string | string[] | undefined };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function TeacherExamMarkingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params;
  const search = await searchParams;
  const mode = first(search.mode) === "question" ? "question" : "sheet";
  return (
    <PageTransition>
      <PageContainer>
        <PageHeader
          eyebrow="تصحیح برگه‌ها"
          title="دفتر تصحیح"
          description="برگهٔ کامل هر دانش‌آموز را ببینید؛ سؤال‌هایی که خود آزمون نمره‌شان را از کلید گرفته‌اند هم با نمره نمایش داده می‌شوند تا چیزی از چشم دور نماند. با کلید «سؤال‌به‌سؤال» یک سؤال را برای همهٔ کلاس نمره بدهید."
          breadcrumbs={[{ label: "آموزگار", href: "/teacher/dashboard" }, { label: "نتایج", href: "/teacher/results" }, { label: "تصحیح" }]}
        />
        <ExamMarkingWorkspace examId={id} initialMode={mode} initialAttemptId={first(search.attempt)} initialQuestionId={first(search.question)}/>
      </PageContainer>
    </PageTransition>
  );
}
