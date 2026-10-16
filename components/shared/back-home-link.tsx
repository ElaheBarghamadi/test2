import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The only way off a signed-out screen.
 *
 * Login, register, forgot-password and reset-password are full-bleed: no site header, no footer, no logo.
 * That is what makes them feel like one screen instead of a page, but a full-screen view with no exit is a
 * trap, so each form renders this above itself.
 *
 * It is a link to `/` and not `router.back()`. Plenty of visitors arrive at `/login` from a shared link or a
 * redirected protected route, in which case there is no history entry to go back to and a "back" button
 * either does nothing or throws them out of the app entirely.
 */
export function BackHomeLink({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted",
        // Pull the optical padding back so the text lines up with the form's own edge.
        "-ms-2",
        className,
      )}
    >
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true"/>
      بازگشت به صفحه اصلی
    </Link>
  );
}
