import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/app/providers";

export const metadata: Metadata = { title: { default: "Examora | ارزیابی هوشمند", template: "%s | Examora" }, description: "پلتفرم مدرن آزمون آنلاین برای مدارس" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="fa" dir="rtl" suppressHydrationWarning><body><Providers>{children}</Providers></body></html>; }
