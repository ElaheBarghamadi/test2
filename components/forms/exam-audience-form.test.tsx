import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExamAudienceForm } from "@/components/forms/exam-audience-form";
import { ApiError } from "@/lib/api/client";
import type { AudienceMode, StudentAudienceItem, StudentGroup } from "@/lib/types/domain";

const groups: StudentGroup[] = [
  { id: "g1", name: "تجربی ۲ — گروه الف", description: "تکمیلی", studentIds: ["s1", "s2", "s3"], studentCount: 3 },
  { id: "g2", name: "کلاس جبرانی", description: "", studentIds: ["s3", "s4"], studentCount: 2 },
];
const roster: StudentAudienceItem[] = [
  { id: "s1", fullName: "سارا احمدی", email: "s1@x.test", grade: "دوازدهم", className: "تجربی ۱" },
  { id: "s2", fullName: "امیر رضایی", email: "s2@x.test", grade: "دوازدهم", className: "تجربی ۱" },
  { id: "s3", fullName: "نگار کریمی", email: "s3@x.test", grade: "دوازدهم", className: "تجربی ۲" },
  { id: "s4", fullName: "یاسین موسوی", email: "s4@x.test", grade: "دوازدهم", className: "تجربی ۲" },
  { id: "s5", fullName: "مریم صادقی", email: "s5@x.test", grade: "دوازدهم", className: "تجربی ۲" },
];

const api = vi.hoisted(() => ({
  studentGroups: vi.fn(),
  studentDirectory: vi.fn(),
}));
vi.mock("@/lib/api/users", () => ({ usersApi: api }));

/**
 * The form is controlled, so the harness has to be the thing that holds the state — otherwise a click emits
 * a patch that nobody applies and the assertions would be testing a component that never changed.
 */
function setup(overrides: Partial<Parameters<typeof ExamAudienceForm>[0]> = {}) {
  const onChange = vi.fn();
  function Harness() {
    const [state, setState] = useState({
      audienceMode: "profile" as AudienceMode,
      studentGroupIds: [] as string[],
      studentIds: [] as string[],
      ...overrides,
    });
    return (
      <ExamAudienceForm
        grade="پایه دوازدهم"
        examClassName="تجربی ۲"
        errors={[]}
        {...state}
        audienceMode={state.audienceMode as AudienceMode}
        onChange={(patch) => { onChange(patch); setState((current) => ({ ...current, ...patch })); }}
      />
    );
  }
  render(<Harness/>);
  return onChange;
}

beforeEach(() => {
  api.studentGroups.mockReset().mockResolvedValue(groups);
  api.studentDirectory.mockReset().mockResolvedValue(roster);
});

describe("exam audience", () => {
  it("explains profile targeting without fetching a roster it will not use", () => {
    setup();
    expect(screen.getByText(/هر دانش‌آموزی که پروفایلش با/)).toBeTruthy();
    expect(screen.getByText("پایه دوازدهم")).toBeTruthy();
    expect(api.studentGroups).not.toHaveBeenCalled();
  });

  it("loads the groups and the roster when selected targeting is chosen", async () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("radio", { name: /گروه‌ها و دانش‌آموزان انتخابی/ }));

    expect(onChange).toHaveBeenCalledWith({ audienceMode: "selected" });
    expect(await screen.findByRole("checkbox", { name: /تجربی ۲ — گروه الف/ })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /کلاس جبرانی/ })).toBeTruthy();
    // Nobody picked yet: the warning is the useful sentence, not an empty "۰ نفر".
    expect(screen.getByText(/باید دست‌کم یک گروه یا یک دانش‌آموز انتخاب کنید/)).toBeTruthy();
  });

  it("counts a student in two chosen groups once", async () => {
    setup({ audienceMode: "selected" as AudienceMode });
    fireEvent.click(await screen.findByRole("checkbox", { name: /تجربی ۲ — گروه الف/ }));
    await waitFor(() => expect(screen.getByText(/۳ دانش‌آموز/)).toBeTruthy());

    // s3 is in both groups; 3 + 2 members is 4 people, not 5.
    fireEvent.click(screen.getByRole("checkbox", { name: /کلاس جبرانی/ }));
    await waitFor(() => expect(screen.getByText(/۴ دانش‌آموز/)).toBeTruthy());
    expect(screen.queryByText(/۵ دانش‌آموز/)).toBeNull();
  });

  it("adds an individual student who is in no group", async () => {
    const onChange = setup({ audienceMode: "selected" as AudienceMode, studentGroupIds: ["g1"] });
    // The roster starts folded: three people are already covered by the group, so the long list is not
    // what the teacher needs to look at first.
    fireEvent.click(await screen.findByRole("button", { name: /انتخاب دانش‌آموزان به‌صورت تکی/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /مریم صادقی/ }));
    expect(onChange).toHaveBeenCalledWith({ studentIds: ["s5"] });
  });

  it("keeps a student who is already listed when the roster is reopened", async () => {
    setup({ audienceMode: "selected" as AudienceMode, studentIds: ["s5"] });
    expect((await screen.findByRole("button", { name: /انتخاب دانش‌آموزان به‌صورت تکی/ })).textContent).toContain("۱ نفر");
  });

  it("surfaces the server's refusal instead of a generic failure", async () => {
    api.studentGroups.mockRejectedValueOnce(new ApiError(403, { detail: "دسترسی به این اطلاعات برای شما مجاز نیست." }));
    setup({ audienceMode: "selected" as AudienceMode });
    expect(await screen.findByText(/دسترسی به این اطلاعات برای شما مجاز نیست/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /تلاش دوباره/ })).toBeTruthy();
  });
});
