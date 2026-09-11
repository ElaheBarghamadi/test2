import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { QuestionBankWorkspace } from "@/components/teacher/question-bank-workspace";

export default async function TeacherQuestionsPage({ searchParams }: { searchParams: Promise<{ exam?: string | string[] }> }) {
  // `?exam=` is set by the builder's "افزودن از بانک" shortcut, so the bank opens already pointed at that
  // exam and the teacher does not choose the destination twice in two different dialogs.
  const { exam } = await searchParams;
  const initialExamId = typeof exam === "string" && exam ? exam : undefined;
  return <PageTransition><PageContainer><PageHeader eyebrow="بانک سؤال" title="بانک سؤال" description="همهٔ سؤال‌ها را جست‌وجو و فیلتر کنید، سطح و برچسب بزنید، و چندتا را یک‌جا به آزمون بعدی کپی کنید." breadcrumbs={[{ label: "آموزگار", href: "/teacher/dashboard" }, { label: "بانک سؤال" }]} /><QuestionBankWorkspace initialExamId={initialExamId}/></PageContainer></PageTransition>;
}
