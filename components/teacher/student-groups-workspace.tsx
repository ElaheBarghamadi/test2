"use client";

import { CheckCircle2, FolderPlus, Layers, LoaderCircle, Pencil, RefreshCw, Trash2, Users, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usersApi } from "@/lib/api/users";
import { apiErrorMessage } from "@/lib/api/client";
import type { StudentAudienceItem, StudentGroup } from "@/lib/types/domain";
import { StudentPicker } from "@/components/teacher/student-picker";
import { Avatar } from "@/components/shared/avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToastStore } from "@/lib/state/toast-store";
import { cn, toPersianNumber } from "@/lib/utils";

/**
 * Grouping is what makes "who may sit this exam" a two-click decision instead of a 200-row checkbox list.
 *
 * The roster itself is read-only here on purpose: enrolment belongs to the school administrator. What a
 * teacher owns is the *set* — a named, reusable slice of their roster that an exam can be pointed at, and
 * that keeps its meaning when the class changes next term.
 */

interface GroupDraft {
  id: string | null;
  name: string;
  description: string;
  studentIds: string[];
}

const emptyDraft = (): GroupDraft => ({ id: null, name: "", description: "", studentIds: [] });

export function StudentGroupsWorkspace() {
  const toast = useToastStore((state) => state.push);
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [students, setStudents] = useState<StudentAudienceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StudentGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [groupRows, roster] = await Promise.all([usersApi.studentGroups(), usersApi.studentDirectory()]);
      setGroups(groupRows);
      setStudents(roster);
    } catch (reason) {
      setError(apiErrorMessage(reason, "دریافت گروه‌ها انجام نشد."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const studentById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const totalMembers = useMemo(() => new Set(groups.flatMap((group) => group.studentIds)).size, [groups]);
  const ungrouped = students.length - totalMembers;

  function openCreate() {
    setFormError({});
    setMessage(null);
    setDraft(emptyDraft());
  }
  function openEdit(group: StudentGroup) {
    setFormError({});
    setMessage(null);
    setDraft({ id: group.id, name: group.name, description: group.description, studentIds: [...group.studentIds] });
  }
  function closeDraft() {
    setDraft(null);
    setFormError({});
    setMessage(null);
  }

  async function saveDraft() {
    if (!draft || saving) return;
    if (!draft.name.trim()) { setFormError({ name: ["نام گروه را وارد کنید."] }); return; }
    setSaving(true);
    setFormError({});
    setMessage(null);
    const payload = { name: draft.name.trim(), description: draft.description.trim(), student_ids: draft.studentIds };
    try {
      const saved = draft.id
        ? await usersApi.updateStudentGroup(draft.id, payload)
        : await usersApi.createStudentGroup(payload);
      setGroups((current) => draft.id
        ? current.map((group) => (group.id === saved.id ? saved : group))
        : [...current, saved].sort((a, b) => a.name.localeCompare(b.name, "fa")));
      toast({
        title: draft.id ? "گروه به‌روزرسانی شد" : "گروه ساخته شد",
        description: `«${saved.name}» با ${toPersianNumber(saved.studentCount)} عضو.`,
        variant: "success",
      });
      closeDraft();
    } catch (reason) {
      const detail = reason as { fieldErrors?: Record<string, string[]> };
      if (detail?.fieldErrors && Object.keys(detail.fieldErrors).length) setFormError(detail.fieldErrors);
      setMessage(apiErrorMessage(reason, "ذخیرهٔ گروه انجام نشد."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setSaving(true);
    setMessage(null);
    try {
      await usersApi.deleteStudentGroup(pendingDelete.id);
      setGroups((current) => current.filter((group) => group.id !== pendingDelete.id));
      toast({ title: "گروه حذف شد", description: `«${pendingDelete.name}» حذف شد؛ آزمون‌های منتشرشده تغییر نکردند.`, variant: "success" });
      setPendingDelete(null);
    } catch (reason) {
      // A group wired to a live exam is refused by the server, and the refusal is the useful sentence.
      setMessage(apiErrorMessage(reason, "حذف گروه انجام نشد."));
    } finally {
      setSaving(false);
    }
  }

  const draftMembers = draft ? draft.studentIds.map((id) => studentById.get(id)).filter((item): item is StudentAudienceItem => Boolean(item)) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="neutral"><Layers className="ml-1 h-3 w-3" />{toPersianNumber(groups.length)} گروه</Badge>
          <Badge variant="neutral"><UsersRound className="ml-1 h-3 w-3" />{toPersianNumber(students.length)} دانش‌آموز در فهرست</Badge>
          {students.length > 0 && (
            <Badge variant={ungrouped > 0 ? "warning" : "success"}>
              {ungrouped > 0 ? `${toPersianNumber(ungrouped)} نفر بدون گروه` : "همه در گروه‌اند"}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />تازه‌سازی
          </Button>
          <Button size="sm" onClick={openCreate} disabled={loading}>
            <FolderPlus className="h-3.5 w-3.5" />گروه جدید
          </Button>
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={Users}
          title="فهرست گروه‌ها دریافت نشد"
          description={error}
          action={{ label: "تلاش دوباره", onClick: () => void load() }}
        />
      ) : loading && groups.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-44 animate-soft-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="هنوز گروهی نساخته‌اید"
          description="گروه، دسته‌ای از دانش‌آموزان است که یک‌بار می‌سازید و بعد در هر آزمون فقط انتخابش می‌کنید. به‌جای علامت‌زدن سی نفر، «کلاس تجربی ۲» را برمی‌دارید."
          action={{ label: "ساخت اولین گروه", onClick: openCreate }}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const members = group.studentIds.map((id) => studentById.get(id)).filter((item): item is StudentAudienceItem => Boolean(item));
            return (
              <Card key={group.id} className="flex flex-col overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Layers className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate text-base">{group.name}</CardTitle>
                      <CardDescription className="mt-1 text-[11px]">
                        {toPersianNumber(group.studentCount)} عضو
                        {group.description ? ` · ${group.description}` : ""}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col justify-between gap-3 pt-0">
                  <div>
                    {members.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {members.slice(0, 6).map((member) => (
                          <span key={member.id} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/45 py-1 pl-2.5 pr-1 text-[10px] font-bold">
                            <Avatar name={member.fullName} size="xs" />
                            <span className="max-w-24 truncate">{member.fullName}</span>
                          </span>
                        ))}
                        {members.length > 6 && (
                          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[10px] font-black text-muted-foreground">
                            +{toPersianNumber(members.length - 6)} نفر دیگر
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="rounded-xl border border-dashed bg-muted/25 p-3 text-[11px] leading-5 text-muted-foreground">
                        {group.studentCount > 0
                          ? "اعضا در فهرست مجاز فعلی شما دیده نمی‌شوند؛ ممکن است به مدرسهٔ دیگری منتقل شده باشند."
                          : "این گروه هنوز عضوی ندارد. با «ویرایش اعضا» دانش‌آموز اضافه کنید."}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 border-t pt-3">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(group)}>
                      <Pencil className="h-3.5 w-3.5" />ویرایش اعضا
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={() => { setMessage(null); setPendingDelete(group); }} aria-label={`حذف گروه ${group.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={Boolean(draft)}
        onClose={closeDraft}
        title={draft?.id ? "ویرایش گروه" : "گروه جدید"}
        description={draft?.id
          ? "نام، توضیح و اعضا را تغییر دهید. آزمون‌های منتشرشده‌ای که این گروه را دارند، فهرست جدید را در تلاش بعدی دانش‌آموز می‌بینند."
          : "یک نام بگذارید و اعضا را انتخاب کنید. بعد از این، در تنظیمات هر آزمون فقط همین گروه را برمی‌دارید."}
        size="lg"
      >
        {draft && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-bold">
                نام گروه
                <Input
                  className="mt-2"
                  value={draft.name}
                  data-autofocus
                  maxLength={120}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="مثلاً تجربی ۲ — گروه الف"
                  aria-invalid={Boolean(formError.name)}
                />
                {formError.name && <span className="mt-1 block text-[11px] font-bold text-destructive">{formError.name[0]}</span>}
              </label>
              <label className="block text-sm font-bold">
                توضیح (اختیاری)
                <Input
                  className="mt-2"
                  value={draft.description}
                  maxLength={300}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="این گروه چه کسانی‌اند؟"
                />
              </label>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-black">اعضای گروه</h3>
                <span className="text-[11px] font-bold text-muted-foreground">{toPersianNumber(draft.studentIds.length)} نفر انتخاب شده</span>
              </div>
              <StudentPicker
                students={students}
                selectedIds={draft.studentIds}
                onChange={(studentIds) => setDraft({ ...draft, studentIds })}
                listClassName="max-h-72"
              />
              {draftMembers.length > 0 && (
                <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
                  {draftMembers.slice(0, 5).map((member) => member.fullName).join("، ")}
                  {draftMembers.length > 5 ? ` و ${toPersianNumber(draftMembers.length - 5)} نفر دیگر` : ""}
                </p>
              )}
            </div>

            {message && (
              <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/[.05] p-3 text-xs font-bold leading-6 text-destructive">{message}</p>
            )}

            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={closeDraft} disabled={saving}>انصراف</Button>
              <Button onClick={() => void saveDraft()} disabled={saving}>
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {draft.id ? "ذخیرهٔ تغییرات" : "ساخت گروه"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(pendingDelete)}
        onClose={() => { setPendingDelete(null); setMessage(null); }}
        title="حذف گروه؟"
        description={pendingDelete ? `«${pendingDelete.name}» با ${toPersianNumber(pendingDelete.studentCount)} عضو حذف می‌شود.` : undefined}
        size="sm"
      >
        <p className="rounded-xl border bg-muted/40 p-3 text-xs leading-6 text-muted-foreground">
          حذف گروه، حساب دانش‌آموزان را پاک نمی‌کند. اگر گروه به آزمون زمان‌بندی‌شده یا فعال وصل باشد، سرور اجازهٔ حذف نمی‌دهد و دلیلش را می‌گوید.
        </p>
        {message && <p role="alert" className="mt-3 rounded-xl border border-destructive/25 bg-destructive/[.05] p-3 text-xs font-bold leading-6 text-destructive">{message}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => { setPendingDelete(null); setMessage(null); }} disabled={saving}>انصراف</Button>
          <Button variant="destructive" onClick={() => void confirmDelete()} disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}حذف گروه
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
