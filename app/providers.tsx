"use client";
import { AuthProvider } from "@/components/auth/auth-provider";
import { Toaster } from "@/components/shared/toaster";
export function Providers({ children }: { children: React.ReactNode }) { return <AuthProvider>{children}<Toaster /></AuthProvider>; }
