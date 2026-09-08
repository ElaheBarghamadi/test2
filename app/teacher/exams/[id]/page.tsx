import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { TeacherExamDetailWorkspace } from "@/components/teacher/exam-detail-workspace";

export default async function TeacherExamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PageTransition><PageContainer><PageHeader eyebrow="جزئیات آزمون" title="نمای آزمون" description="وضعیت، سؤال‌ها، تنظیمات و عملکرد آزمون را در یک نمای متمرکز بررسی کنید." breadcrumbs={[{ label: "آموزگار", href: "/teacher/dashboard" }, { label: "آزمون‌ها", href: "/teacher/exams" }, { label: "جزئیات" }]}/><TeacherExamDetailWorkspace examId={id}/></PageContainer></PageTransition>;
}
