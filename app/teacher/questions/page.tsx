import { ListPlus } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { QuestionBankWorkspace } from "@/components/teacher/question-bank-workspace";
export default function TeacherQuestionsPage() { return <PageTransition><PageContainer><PageHeader eyebrow="بانک سؤال" title="بانک سؤال" description="همهٔ سؤال‌ها را جست‌وجو و فیلتر کنید، سطح و برچسب بزنید، و چندتا را یک‌جا به آزمون بعدی کپی کنید." breadcrumbs={[{ label: "آموزگار", href: "/teacher/dashboard" }, { label: "بانک سؤال" }]}/><QuestionBankWorkspace/></PageContainer></PageTransition>; }
