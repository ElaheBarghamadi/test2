import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { ExamCreator } from "@/components/forms/exam-creator";

export default async function EditExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PageTransition><PageContainer><PageHeader eyebrow="ویرایش آزمون" title="ویرایش و تکمیل آزمون" description="از همان جریان ساخت آزمون برای اصلاح سؤال‌ها، تنظیمات و زمان‌بندی استفاده کنید." breadcrumbs={[{ label: "آموزگار", href: "/teacher/dashboard" }, { label: "آزمون‌ها", href: "/teacher/exams" }, { label: "ویرایش" }]}/><ExamCreator examId={id}/></PageContainer></PageTransition>;
}
