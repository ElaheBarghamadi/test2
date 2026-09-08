import { StudentResultWorkspace } from "@/components/exam/student-result-workspace";
export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <StudentResultWorkspace attemptId={id}/>; }
