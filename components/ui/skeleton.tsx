import { cn } from "@/lib/utils";
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("animate-soft-pulse rounded-lg bg-muted", className)} {...props} />; }
