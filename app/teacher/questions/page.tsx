import { ListPlus } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { QuestionBankWorkspace } from "@/components/teacher/question-bank-workspace";
export default function TeacherQuestionsPage() { return <PageTransition><PageContainer><PageHeader eyebrow="بانک سؤال" title="مدیریت سؤال‌ها" description="سؤال‌ها را در آزمون مالک‌شان بسازید، ویرایش کنید و با همان API ذخیره کنید." breadcrumbs={[{ label: "آموزگار", href: "/teacher/dashboard" }, { label: "بانک سؤال" }]}/><QuestionBankWorkspace/></PageContainer></PageTransition>; }
