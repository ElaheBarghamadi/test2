import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
export function FlagQuestionButton({ flagged, onClick, disabled = false }: { flagged: boolean; onClick: () => void; disabled?: boolean }) { return <Button variant={flagged ? "secondary" : "ghost"} size="sm" onClick={onClick} disabled={disabled} aria-pressed={flagged} className={cn("h-10 shrink-0 px-3 sm:h-8", flagged && "text-warning")}><Flag className={cn("h-3.5 w-3.5", flagged && "fill-current")}/>{flagged ? "نشان‌دار" : "نشانه‌گذاری"}</Button>; }
