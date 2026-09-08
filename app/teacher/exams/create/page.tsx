import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { ExamCreator } from "@/components/forms/exam-creator";
export default function CreateExamPage() { return <PageTransition><PageContainer><PageHeader eyebrow="آزمون جدید" title="ساخت آزمون" description="با چند گام روشن، آزمونی منظم و آماده برای کلاس بسازید." breadcrumbs={[{ label: "آموزگار", href: "/teacher/dashboard" }, { label: "آزمون‌ها", href: "/teacher/exams" }, { label: "ساخت آزمون" }]}/><ExamCreator/></PageContainer></PageTransition>; }
