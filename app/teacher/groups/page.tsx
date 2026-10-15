"use client";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { StudentGroupsWorkspace } from "@/components/teacher/student-groups-workspace";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { UsersRound } from "lucide-react";

export default function TeacherGroupsPage() {
  return (
    <PageTransition>
      <PageContainer>
        <PageHeader
          eyebrow="مخاطبان آزمون"
          title="گروه‌بندی دانش‌آموزان"
          description="یک‌بار گروه می‌سازید و در تنظیمات هر آزمون فقط همان گروه را انتخاب می‌کنید؛ دیگر لازم نیست برای هر آزمون سی نفر را دستی علامت بزنید."
          breadcrumbs={[{ label: "آموزگار", href: "/teacher/dashboard" }, { label: "گروه‌ها" }]}
          action={<Button asChild variant="outline"><Link href="/teacher/students"><UsersRound className="h-4 w-4" />فهرست دانش‌آموزان</Link></Button>}
        />
        <StudentGroupsWorkspace />
      </PageContainer>
    </PageTransition>
  );
}
