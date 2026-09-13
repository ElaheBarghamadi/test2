/**
 * Saving a server payload as a file, from the browser.
 *
 * A plain link cannot be used for any of these: the API is called with an `Authorization` header, and an
 * anchor would arrive unauthenticated. So the bytes are fetched through the API client and handed to a blob
 * URL — with one care worth naming: the URL is revoked on the next tick, because a URL holding a school's
 * exam data would otherwise stay reachable for the life of the document.
 */
export function downloadFile(filename: string, contents: string, mime = "application/json") {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A server date to a filename fragment, so a download sorts next to the day it was taken. */
export function stamp(value = new Date()) {
  return value.toISOString().slice(0, 10);
}
