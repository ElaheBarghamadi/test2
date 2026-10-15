import { PageSkeleton } from "@/components/shared/skeleton";

/**
 * The route's own silhouette, shown the moment a link is clicked.
 *
 * Without this the previous page stays on screen until the next one's JavaScript has landed, which on a
 * slow link reads as "my click did nothing". The skeleton is not a spinner: it has the header band, the
 * toolbar and the card grid the real page will have, so nothing jumps when the content replaces it.
 */
export default function Loading() {
  return <PageSkeleton variant="dashboard" cards={3} label="در حال آماده‌سازی نمای کلی"/>;
}
