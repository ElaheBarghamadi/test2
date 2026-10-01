import { cn } from "@/lib/utils";

/**
 * Loading placeholders.
 *
 * The app used to answer "not yet" with either a spinner or a pair of grey rectangles of the wrong size, which
 * on a slow connection is the difference between "this is arriving" and "this is broken". A skeleton that is
 * laid out like the page it replaces says both *something is coming* and *what* is coming, and it stops the
 * layout from jumping when the real content lands.
 */
export function Skeleton({ className, rounded = "rounded-xl" }: { className?: string; rounded?: string }) {
  // `aria-hidden` because the surrounding region already announces its own busy state: a screen reader should
  // hear "loading" once, not once per placeholder block.
  return <span aria-hidden="true" className={cn("skeleton block", rounded, className)} />;
}

/** A form field: label line, control block, optional hint. */
export function SkeletonField({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      <Skeleton className="h-3.5 w-24"/>
      <Skeleton className="h-11 w-full"/>
    </div>
  );
}

/**
 * The shape of the exam builder.
 *
 * Used both by the builder itself while it fetches an exam to edit and by the route-level `loading.tsx` files,
 * so the first paint of `/teacher/exams/create` and of an edit route is the page's own silhouette rather than a
 * blank screen. It follows the real grid: a step rail above the card on a phone, a sidebar beside it from `xl`.
 */
export function ExamBuilderSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-[250px_minmax(0,1fr)]" data-testid="exam-builder-skeleton" role="status" aria-label="در حال آماده‌سازی فرم ساخت آزمون">
      <div className="rounded-2xl border bg-card p-3 shadow-soft">
        <div className="flex items-center justify-between gap-2 px-1">
          <Skeleton className="h-3.5 w-20"/>
          <Skeleton className="h-3 w-14"/>
        </div>
        <Skeleton className="mt-3 h-1 w-full" rounded="rounded-full"/>
        {/* The rail is a horizontal strip on a phone and a column on a wide screen, exactly like the real one. */}
        <div className="mt-3 flex gap-2 xl:block xl:space-y-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-10 w-32 shrink-0 xl:w-full"/>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border bg-card shadow-soft">
        <div className="border-b p-5 sm:p-6">
          <Skeleton className="h-3 w-28"/>
          <Skeleton className="mt-3 h-6 w-40"/>
          <Skeleton className="mt-3 h-4 w-64 max-w-full"/>
        </div>
        <div className="space-y-6 p-5 sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <SkeletonField/>
            <SkeletonField/>
            <SkeletonField/>
            <SkeletonField/>
          </div>
          <div className="space-y-2.5">
            <Skeleton className="h-3.5 w-28"/>
            <Skeleton className="h-28 w-full"/>
          </div>
          <div className="flex items-center justify-between gap-3 border-t pt-5">
            <Skeleton className="h-10 w-24"/>
            <Skeleton className="h-10 w-32"/>
          </div>
        </div>
      </div>
    </div>
  );
}
