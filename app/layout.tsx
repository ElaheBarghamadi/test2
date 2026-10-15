import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/app/providers";

export const metadata: Metadata = { title: { default: "Examora | ارزیابی هوشمند", template: "%s | Examora" }, description: "پلتفرم مدرن آزمون آنلاین برای مدارس" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#4f46e5" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        {/*
          The Persian face is served from this origin, so preloading it costs nothing on an offline network
          and removes the flash of fallback glyphs on the first paint. `crossOrigin` is required for fonts
          even on a same-origin request — without it the browser fetches the file twice.
        */}
        <link rel="preload" href="/fonts/Vazirmatn-var.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
