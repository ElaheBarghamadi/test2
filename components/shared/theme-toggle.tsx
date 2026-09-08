"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useThemeStore } from "@/lib/state/theme-store";

export function ThemeToggle() {
  const { theme, hydrated, hydrate, setTheme } = useThemeStore();
  useEffect(() => { hydrate(); }, [hydrate]);
  return <Button type="button" variant="ghost" size="icon" aria-label="تغییر پوسته" title="تغییر پوسته" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
    {hydrated && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
  </Button>;
}
