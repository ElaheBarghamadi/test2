"use client";

import { KeyRound, Search, ShieldOff, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/api/admin";
import { apiErrorMessage } from "@/lib/api/client";
import type { ApiAdminUserDto, ApiRole } from "@/lib/api/dtos";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { Avatar } from "@/components/shared/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/state/auth-store";
import { formatDateTime, toPersianNumber } from "@/lib/utils";
import { useToastStore } from "@/lib/state/toast-store";

/**
 * Access: who is signed in where, and how to stop it.
 *
 * `/admin/users` already creates accounts and changes roles. This screen is for the other question an
 * administrator gets — "someone left their session open on a lab computer", "an account is being shared" —
 * where the answer is not to delete the person but to cut the sessions off.
 *
 * Revoking blacklists the refresh tokens, so no *new* access token can be minted. An access token already in
 * a browser lives until it expires; the notice under the list says exactly that, because an administrator who
 * believes they locked a door immediately would act on that belief.
 */
const roleLabel: Record<ApiRole, string> = { admin: "مدیر سامانه", school_admin: "مدیر مدرسه", teacher: "آموزگار", student: "دانش‌آموز" };

export default function AdminAccessPage() {
  const viewer = useAuthStore((state) => state.user);
  const toast = useToastStore((state) => state.push);
  const [users, setUsers] = useState<ApiAdminUserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | ApiRole>("all");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUsers(await adminApi.users());
    } catch (reason) {
      setError(apiErrorMessage(reason, "دریافت کاربران انجام نشد."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(
    () =>
      users.filter(
        (user) =>
          (role === "all" || user.role === role) &&
          `${user.full_name} ${user.email} ${user.school?.name ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [query, role, users],
  );

  async function revoke(user: ApiAdminUserDto) {
    setBusy(user.id);
    try {
      const result = await adminApi.revokeSessions(user.id);
      await load();
      toast({
        title: `نشست‌های ${user.full_name || user.email} قطع شد`,
        description: `${toPersianNumber(result.revoked)} توکن بازنشانی مسدود شد. نشستی که همین حالا باز است تا چند دقیقهٔ دیگر بسته می‌شود.`,
        variant: "success",
      });
    } catch (reason) {
      toast({ title: "قطع نشست انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageTransition>
      <PageContainer>
        <PageHeader
          eyebrow="مدیریت دسترسی"
          title="نشست‌ها و دسترسی"
          description="هر حسابی که در سامانه هست، آخرین فعالیتش، و ابزاری که با آن نشست‌های باز بسته می‌شوند."
          breadcrumbs={[{ label: "مدیر سامانه" }, { label: "دسترسی" }]}
        />
        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4"/>حساب‌ها</CardTitle>
              <CardDescription>{toPersianNumber(shown.length)} از {toPersianNumber(users.length)} حساب نمایش داده می‌شود.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative min-w-48">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
                <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pr-9" placeholder="نام، ایمیل یا مدرسه"/>
              </div>
              <select value={role} onChange={(event) => setRole(event.target.value as "all" | ApiRole)} aria-label="فیلتر نقش" className="h-11 rounded-xl border bg-background px-2 text-sm font-bold">
                <option value="all">همهٔ نقش‌ها</option>
                <option value="student">دانش‌آموز</option>
                <option value="teacher">آموزگار</option>
                <option value="school_admin">مدیر مدرسه</option>
                <option value="admin">مدیر سامانه</option>
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {error ? (
              <EmptyState title="فهرست در دسترس نیست" description={error} action={{ label: "تلاش دوباره", onClick: () => void load() }}/>
            ) : loading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <Skeleton className="h-14 rounded-2xl" key={index}/>)}</div>
            ) : shown.length ? (
              <div className="space-y-2">
                {shown.map((user) => (
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border p-3" key={user.id}>
                    <Avatar name={user.full_name || user.email} size="sm"/>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{user.full_name || "بدون نام"}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {user.email} · {user.school?.name || "بدون مدرسه"} · آخرین فعالیت {user.last_login ? formatDateTime(user.last_login) : "—"}
                      </p>
                    </div>
                    <Badge variant={user.is_active ? "neutral" : "destructive"}>{user.is_active ? "فعال" : "غیرفعال"}</Badge>
                    <Badge variant="teal">{roleLabel[user.role]}</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === user.id || user.id === viewer?.id}
                      onClick={() => void revoke(user)}
                      title={user.id === viewer?.id ? "نشست خودتان را نمی‌توانید از همین‌جا ببندید." : "همهٔ نشست‌های این حساب بسته می‌شود"}
                    >
                      <ShieldOff className="h-3.5 w-3.5"/>قطع نشست‌ها
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="حسابی با این فیلترها پیدا نشد" description="نام، ایمیل یا مدرسه را عوض کنید."/>
            )}
            <p className="mt-4 flex items-start gap-2 rounded-2xl bg-muted/60 p-3 text-[11px] leading-5 text-muted-foreground">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"/>
              قطع نشست، توکن‌های بازنشانی را مسدود می‌کند؛ یعنی هیچ نشست تازه‌ای از آن دستگاه ساخته نمی‌شود. دسترسی که همین حالا در مرورگر باز است تا
              پایان اعتبار توکن فعلی (چند دقیقه) باقی می‌ماند — این رفتارِ خودِ JWT است، نه کاستی این پنل.
            </p>
          </CardContent>
        </Card>
      </PageContainer>
    </PageTransition>
  );
}
