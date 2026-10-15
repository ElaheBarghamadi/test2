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
          {[0, 1, 2, 3, 4, 5].map((index) => (
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

/**
 * A page silhouette for the route-level `loading.tsx` files.
 *
 * Every screen in this app is a client component that fetches on mount, so the wait has two parts: the route's
 * JavaScript, then its data. The first part is what `loading.tsx` covers, and covering it is what makes a click
 * feel answered — the next page is on screen immediately, in the shape it will have, instead of the previous
 * page hanging on until the new one is ready.
 *
 * The variants follow the real layouts (header band, then toolbar, then cards or a two-column detail) so the
 * content landing on top of them does not move anything the reader is already looking at.
 */
export function PageSkeleton({
  variant = "list",
  cards = 6,
  label = "در حال آماده‌سازی صفحه",
}: {
  variant?: "dashboard" | "list" | "detail" | "form";
  cards?: number;
  label?: string;
}) {
  return (
    <div className="page-container" role="status" aria-busy="true" aria-label={label}>
      {/* The header band, in the same rounded surface the real one uses. */}
      <div className="page-header-surface mb-6 p-4 sm:mb-8 sm:p-6 lg:p-7">
        <div className="mb-4 flex items-center gap-2">
          <Skeleton className="h-6 w-6" rounded="rounded-lg" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-3" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0 space-y-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-56 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-10 w-32 shrink-0" />
        </div>
      </div>

      {variant === "dashboard" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-2xl border bg-card p-5">
              <Skeleton className="h-9 w-9" rounded="rounded-xl" />
              <Skeleton className="mt-4 h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-14" />
            </div>
          ))}
        </div>
      )}

      {(variant === "list" || variant === "dashboard") && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-10 w-full sm:max-w-xs" />
            <div className="flex gap-2">
              <Skeleton className="h-10 w-28" />
              <Skeleton className="h-10 w-32" />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: cards }).map((_, index) => (
              <div key={index} className="rounded-2xl border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-5 w-16" rounded="rounded-full" />
                </div>
                <Skeleton className="mt-3 h-3 w-full" />
                <Skeleton className="mt-2 h-3 w-2/3" />
                <Skeleton className="mt-5 h-2 w-full" rounded="rounded-full" />
                <div className="mt-5 flex items-center justify-between border-t pt-4">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {variant === "detail" && (
        <div className="grid gap-6 xl:grid-cols-[1.24fr_.76fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border bg-card p-5 sm:p-6">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-2 h-3 w-64 max-w-full" />
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="rounded-xl bg-muted/55 p-3">
                    <Skeleton className="h-4 w-4" rounded="rounded-md" />
                    <Skeleton className="mt-4 h-2.5 w-16" />
                    <Skeleton className="mt-2 h-3 w-24" />
                  </div>
                ))}
              </div>
              <Skeleton className="mt-6 h-24 w-full" rounded="rounded-2xl" />
            </div>
          </div>
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="rounded-2xl border bg-card p-5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-4 h-3 w-full" />
                <Skeleton className="mt-2 h-3 w-4/5" />
              </div>
            ))}
          </div>
        </div>
      )}

      {variant === "form" && (
        <div className="rounded-2xl border bg-card shadow-soft">
          <div className="border-b p-5 sm:p-6">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-3 h-6 w-40" />
          </div>
          <div className="space-y-5 p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <SkeletonField />
              <SkeletonField />
              <SkeletonField />
              <SkeletonField />
            </div>
            <Skeleton className="h-28 w-full" rounded="rounded-2xl" />
          </div>
        </div>
      )}
    </div>
  );
}
