import Link from "next/link";
import { ChevronLeft, Home } from "lucide-react";

export interface Crumb { label: string; href?: string; }

export function PageHeader({
  eyebrow,
  title,
  description,
  breadcrumbs = [],
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header-surface mb-6 p-4 sm:mb-8 sm:p-6 lg:p-7">
      <div className="page-header-content">
        <nav
          className="page-header-breadcrumbs mb-4 flex max-w-full items-center gap-1.5 overflow-x-auto whitespace-nowrap text-[11px] text-muted-foreground sm:mb-5"
          aria-label="مسیر صفحه"
        >
          <Link href="/" aria-label="خانه" className="rounded-lg border border-transparent p-1.5 transition-colors hover:border-border hover:bg-muted">
            <Home className="h-3.5 w-3.5" />
          </Link>
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex shrink-0 items-center gap-1.5">
              <ChevronLeft className="h-3 w-3 opacity-60" />
              {crumb.href ? (
                <Link className="rounded-md px-1 py-1 transition-colors hover:bg-muted hover:text-foreground" href={crumb.href}>
                  {crumb.label}
                </Link>
              ) : (
                <span className="max-w-40 truncate font-semibold text-foreground/75">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>

        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end sm:gap-6">
          <div className="min-w-0">
            {eyebrow && <p className="section-label mb-3">{eyebrow}</p>}
            <h1 className="break-words text-2xl font-black leading-[1.35] tracking-tight sm:text-3xl lg:text-[2rem]">
              {title}
            </h1>
            {description && (
              <p className="mt-2 max-w-3xl text-[13px] leading-7 text-muted-foreground sm:text-sm">
                {description}
              </p>
            )}
          </div>
          {action && <div className="page-header-action shrink-0">{action}</div>}
        </div>
      </div>
    </header>
  );
}

export function PageContainer({ children }: { children: React.ReactNode }) {
  return <div className="page-container">{children}</div>;
}
