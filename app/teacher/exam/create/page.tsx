import { redirect } from "next/navigation";

/** Backward-compatible route for older links; the canonical path is plural: /teacher/exams/create. */
export default function LegacyCreateExamPage() {
  redirect("/teacher/exams/create");
}
