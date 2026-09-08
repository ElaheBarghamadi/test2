import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/forms/reset-password-form";

export default function ResetPasswordPage() {
  return <Suspense fallback={<div className="mx-auto h-80 w-full max-w-md animate-soft-pulse rounded-2xl bg-muted"/>}><ResetPasswordForm/></Suspense>;
}
