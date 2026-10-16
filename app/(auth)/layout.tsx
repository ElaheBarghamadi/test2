/**
 * The frame around every screen a signed-out visitor sees: login, register, forgot-password, reset-password.
 *
 * There deliberately isn't one. No site header, no footer, no logo, no trust strip: the visitor arrived to
 * do exactly one thing, and every row of chrome is a row the form does not have. The shell is one viewport
 * tall (`h-dvh`) and clips, and the screens inside are full-bleed and own their own scrolling — so nothing
 * here can push the page past the fold and the header can never scroll away, because there is no header.
 *
 * The only navigation offered is the «بازگشت به صفحه اصلی» link each form renders above itself
 * (`components/shared/back-home-link.tsx`). It lives in the forms rather than here because on `lg` the card
 * is split in two and the link belongs over the form half, not over the showcase half.
 *
 * The decoration that is left — the soft grid and the two radial washes in `auth-shell` — shows through on
 * phones, where the form half is transparent; on `lg` the card covers it and the brand panel carries the
 * colour instead.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell relative flex h-dvh flex-col overflow-hidden bg-surface">
      <span aria-hidden="true" className="soft-grid pointer-events-none absolute inset-0 opacity-40"/>

      {/*
       * `min-h-0` is what lets the screen inside actually fill this space instead of pushing the shell
       * open: a flex child defaults to `min-height: auto` and refuses to shrink below its content, which
       * would quietly turn `h-dvh` back into "at least a viewport".
       */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
