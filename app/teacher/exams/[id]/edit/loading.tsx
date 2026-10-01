import { ExamBuilderSkeleton } from "@/components/shared/skeleton";

/** The edit route loads an exam from the server before it can render anything, so it gets the same silhouette. */
export default function EditExamLoading() {
  return <div className="mx-auto max-w-[1540px] p-4 sm:p-6 lg:p-8"><ExamBuilderSkeleton/></div>;
}
