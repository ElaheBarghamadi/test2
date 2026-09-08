import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
export function EmptyState({ title, description, icon: Icon = Inbox, action }: { title: string; description: string; icon?: LucideIcon; action?: { label: string; onClick: () => void } }) { return <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/25 px-6 py-12 text-center"><div className="mb-4 rounded-2xl bg-background p-3 text-primary shadow-soft"><Icon className="h-6 w-6" /></div><h3 className="font-extrabold">{title}</h3><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>{action && <Button className="mt-5" onClick={action.onClick}>{action.label}</Button>}</div>; }
