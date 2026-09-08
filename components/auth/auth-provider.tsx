"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/state/auth-store";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const bootstrap = useAuthStore((state) => state.bootstrap);
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  return <>{children}</>;
}
