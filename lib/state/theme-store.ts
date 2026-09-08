"use client";

import { create } from "zustand";

export type Theme = "light" | "dark";
interface ThemeState { theme: Theme; hydrated: boolean; setTheme: (theme: Theme) => void; hydrate: () => void; }

export const useThemeStore = create<ThemeState>((set) => ({
  theme: "light",
  hydrated: false,
  setTheme: (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("examora-theme", theme);
    set({ theme });
  },
  hydrate: () => {
    const saved = localStorage.getItem("examora-theme") as Theme | null;
    const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const theme = saved ?? system;
    document.documentElement.classList.toggle("dark", theme === "dark");
    set({ theme, hydrated: true });
  },
}));
