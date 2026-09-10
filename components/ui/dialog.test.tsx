import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Mirrors the real call sites (admin/users, admin/schools, results grading, question builder):
 *  an inline arrow `onClose` plus controlled inputs, so every keystroke re-renders the dialog
 *  with a brand-new `onClose` identity. Regression guard: that used to re-run the focus effect and
 *  snap the caret back to the first field, making any modal input impossible to type in. */
function SchoolFormDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", city: "" });
  return (
    <>
      <Button onClick={() => setOpen(true)}>add school</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="مدرسه" description="اطلاعات مدرسه">
        <form onSubmit={(event) => event.preventDefault()}>
          <label>
            نام
            <Input data-autofocus value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            شهر
            <Input value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} />
          </label>
          <Button type="submit">ذخیره</Button>
        </form>
      </Dialog>
    </>
  );
}

// Long enough for the deferred autofocus timer, and for any effect that steals focus to run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

async function openDialog() {
  render(<SchoolFormDialog />);
  const trigger = screen.getByRole("button", { name: "add school" });
  trigger.focus();
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  return trigger;
}

async function typeInto(input: HTMLInputElement, text: string) {
  input.focus();
  for (const char of text) {
    fireEvent.keyDown(input, { key: char });
    fireEvent.change(input, { target: { value: `${input.value}${char}` } });
    await settle();
  }
}

describe("Dialog focus management", () => {
  it("moves focus into the dialog on open", async () => {
    await openDialog();
    await settle();
    const first = document.querySelector<HTMLInputElement>("[data-autofocus]")!;
    expect(screen.getByRole("dialog").contains(first)).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("keeps the caret in the last field while typing in a modal", async () => {
    await openDialog();
    const [name, city] = screen.getAllByRole("textbox") as HTMLInputElement[];
    await typeInto(city, "تهران");

    expect(document.activeElement).toBe(city);
    expect(city.value).toBe("تهران");
    expect(name.value).toBe("");
  });

  it("keeps the caret in the first field while typing there", async () => {
    await openDialog();
    const name = document.querySelector<HTMLInputElement>("[data-autofocus]")!;
    await typeInto(name, "البرز");

    expect(document.activeElement).toBe(name);
    expect(name.value).toBe("البرز");
  });

  it("closes on Escape through the latest onClose and hands focus back to the trigger", async () => {
    const trigger = await openDialog();
    const city = screen.getAllByRole("textbox")[1] as HTMLInputElement;
    await typeInto(city, "قزوین");

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 2000 });
    expect(document.activeElement).toBe(trigger);
  });
});
