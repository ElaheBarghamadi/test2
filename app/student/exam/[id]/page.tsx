import { StudentExamSession } from "@/components/exam/student-exam-session";
export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <StudentExamSession examId={id} mode="start"/>; }
