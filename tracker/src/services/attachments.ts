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
 * Builds the authenticated tracker API path that proxies a JIRA issue
 * attachment (the daemon fetches it from JIRA with the operator's credentials).
 */
export function jiraAttachmentUrl(projectSlug: string, attachmentId: string): string {
  const slug = projectSlug.trim();
  if (!slug) throw new Error("projectSlug is required");

  const id = attachmentId.trim();
  if (!id) throw new Error("attachmentId is required");

  return trackerPath(`/projects/${encodeURIComponent(slug)}/jira/attachments/${encodeURIComponent(id)}`);
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

export function isVideoMediaType(mediaType: string | null | undefined): boolean {
  if (typeof mediaType !== "string" || mediaType.length === 0) return false;
  return mediaType.startsWith("video/");
}

export function isVideoAttachmentSource(src: string | null | undefined): boolean {
  if (typeof src !== "string" || src.length === 0) return false;

  const path = src.split("?")[0]?.split("#")[0] ?? src;
  return /\.(webm|mp4)$/i.test(path);
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
