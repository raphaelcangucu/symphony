import { API_PREFIX } from "@/config";

import { http, trackerPath } from "./http";

const ATTACHMENT_PATH_SEGMENT = "/assistant/attachments/";

/**
 * Builds the authenticated tracker API path that serves a stored project
 * attachment (e.g. `uploads/<id>.png`).
 */
export function projectAttachmentUrl(projectSlug: string, relativePath: string): string {
  const slug = projectSlug.trim();
  if (!slug) throw new Error("projectSlug is required");

  const path = relativePath.trim().replace(/^\/+/, "");
  if (!path) throw new Error("attachment path is required");

  const encoded = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return trackerPath(`/projects/${encodeURIComponent(slug)}/assistant/attachments/${encoded}`);
}

/**
 * True when a URL points at the local tracker attachment endpoint, which
 * requires an Authorization header and therefore cannot be rendered by a
 * plain <img src>.
 */
export function isInternalAttachmentUrl(src: string | null | undefined): boolean {
  if (typeof src !== "string" || src.length === 0) return false;
  if (/^(data:|blob:)/i.test(src)) return false;

  return src.includes(`${API_PREFIX}/projects/`) && src.includes(ATTACHMENT_PATH_SEGMENT);
}

const objectUrlCache = new Map<string, Promise<string>>();

/**
 * Fetches an attachment with the tracker bearer token and returns a blob object
 * URL suitable for an <img src>. Results are cached per source so repeated
 * renders reuse a single object URL for the lifetime of the page.
 */
export function fetchAttachmentObjectUrl(src: string): Promise<string> {
  if (!src) throw new Error("attachment src is required");

  const cached = objectUrlCache.get(src);
  if (cached) return cached;

  const pending = http
    .get(src, { responseType: "blob" })
    .then((response) => URL.createObjectURL(response.data as Blob))
    .catch((cause) => {
      objectUrlCache.delete(src);
      throw cause;
    });

  objectUrlCache.set(src, pending);
  return pending;
}
