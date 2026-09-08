import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { TeacherExamListWorkspace } from "@/components/teacher/exam-list-workspace";
import { Button } from "@/components/ui/button";

export default function TeacherExamsPage() {
  return <PageTransition><PageContainer><PageHeader eyebrow="مدیریت آزمون" title="آزمون‌ها" description="آزمون‌های جاری، زمان‌بندی‌شده، پیش‌نویس و بایگانی‌شده را یک‌جا مدیریت کنید." breadcrumbs={[{ label: "آموزگار", href: "/teacher/dashboard" }, { label: "آزمون‌ها" }]} action={<Button asChild><Link href="/teacher/exams/create"><FilePlus2 className="h-4 w-4"/>ساخت آزمون</Link></Button>}/><TeacherExamListWorkspace/></PageContainer></PageTransition>;
}
