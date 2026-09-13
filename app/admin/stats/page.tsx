"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api/admin";
import { apiErrorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AdminStatsConsole } from "@/components/admin/stats-console";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { useAuthStore } from "@/lib/state/auth-store";

/**
 * The administrator's operational screen: the site's numbers, the state of its data, and the open sittings.
 *
 * A school administrator lands on the same page and gets one school's figures — the API scopes every count,
 * and `canControl` follows the role so the actions that override other people's data are not even offered.
 */
export default function AdminStatsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const [error, setError] = useState<string | null>(null);
  const canControl = role === "admin";

  useEffect(() => {
    // The console reads three endpoints. If the session itself is refused, that has to show up as one
    // sentence rather than three silently empty cards, so the probe is the stats call itself.
    void adminApi.stats().catch((reason) => setError(apiErrorMessage(reason, "آمار در دسترس نیست.")));
  }, []);

  return (
    <PageTransition>
      <PageContainer>
        <PageHeader
          eyebrow={canControl ? "مدیر سامانه" : "مدیریت مدرسه"}
          title={canControl ? "آمار و وضعیت سامانه" : "آمار مدرسه"}
          description="شمارش‌ها، نمودارهای چهارده روز اخیر، وضعیت پایگاه داده و نشست‌های در جریان."
          breadcrumbs={[{ label: "مدیر سامانه" }, { label: "آمار" }]}
        />
        {error && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-5 text-sm">
              <span className="min-w-0 flex-1 text-destructive">{error}</span>
              <Button onClick={() => window.location.reload()}>تلاش دوباره</Button>
            </CardContent>
          </Card>
        )}
        <AdminStatsConsole canControl={canControl}/>
      </PageContainer>
    </PageTransition>
  );
}
