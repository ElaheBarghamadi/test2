"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/client";
import type { MediaKind } from "@/lib/types/domain";
import { cn } from "@/lib/utils";

/** Authenticated media stays private: the browser fetches a Blob with the current JWT, never a public URL. */
export function PrivateMedia({
  url,
  file,
  kind,
  alt = "",
  className,
  controls = true,
}: {
  url?: string;
  file?: File;
  kind: MediaKind;
  alt?: string;
  className?: string;
  controls?: boolean;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setSource(objectUrl);
      setFailed(false);
      return () => URL.revokeObjectURL(objectUrl);
    }
    if (!url) {
      setSource(null);
      return;
    }
    const controller = new AbortController();
    setSource(null);
    setFailed(false);
    void apiRequest<Blob>(url, { signal: controller.signal, responseType: "blob" })
      .then((blob) => setSource(URL.createObjectURL(blob)))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => {
      controller.abort();
      setSource((current) => {
        if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
        return null;
      });
    };
  }, [file, url]);

  useEffect(() => () => {
    if (source?.startsWith("blob:")) URL.revokeObjectURL(source);
  }, [source]);

  if (failed) return <div role="status" className={cn("rounded-xl border border-dashed bg-muted/50 p-3 text-xs text-muted-foreground", className)}>بارگذاری رسانه انجام نشد؛ اتصال را بررسی کنید.</div>;
  if (!source) return <div aria-label="در حال بارگذاری رسانه" className={cn("animate-soft-pulse rounded-xl bg-muted", kind === "image" ? "h-48" : "h-12", className)} />;
  return kind === "image"
    ? <img src={source} alt={alt} className={cn("max-h-[520px] max-w-full rounded-xl object-contain", className)} />
    : <audio src={source} controls={controls} preload="metadata" className={cn("w-full", className)} aria-label={alt || "صدای سؤال"} />;
}
