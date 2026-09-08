"use client";

import { LockKeyhole } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** Avoids presenting seeded/demo records as real administration data when no API model exists. */
export function AdminModuleUnavailable({ title, description }: { title: string; description: string }) {
  return <Card className="mx-auto max-w-2xl overflow-hidden"><div className="h-1.5 bg-gradient-to-l from-amber-400 to-primary"/><CardContent className="p-7 text-center sm:p-10"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-500/10 text-amber-600"><LockKeyhole className="h-7 w-7"/></div><h2 className="mt-5 text-xl font-black">{title}</h2><p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-muted-foreground">{description}</p><p className="mt-5 rounded-xl bg-muted/60 p-3 text-xs leading-6 text-muted-foreground">برای جلوگیری از نمایش دادهٔ ساختگی یا دسترسی بیش از حد، این صفحه تا زمان ایجاد مدل و API سازمانی فقط همین وضعیت صادقانه را نشان می‌دهد.</p></CardContent></Card>;
}
