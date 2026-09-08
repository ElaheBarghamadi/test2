import type * as React from "react";
import { cn } from "@/lib/utils";
export function Progress({ value, className, ...props }: { value: number; className?: string } & React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("h-2 overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} {...props}><div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>; }
