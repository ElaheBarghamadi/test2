import { ExamBuilderSkeleton } from "@/components/shared/skeleton";

/**
 * What the route shows while its JavaScript and data are on the way.
 *
 * `/teacher/exams/create` is a client page, so on a slow connection there used to be a blank screen until the
 * bundle landed and the exam store hydrated. The skeleton is the page's own silhouette, which makes the wait
 * legible and keeps the layout from jumping once the form appears.
 */
export default function CreateExamLoading() {
  return <div className="mx-auto max-w-[1540px] p-4 sm:p-6 lg:p-8"><ExamBuilderSkeleton/></div>;
}
