import { API_PREFIX } from "@/config";

import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";

import { http, trackerPath } from "./http";

const ATTACHMENT_PATH_SEGMENT = "/assistant/attachments/";
const EVIDENCE_ARTIFACT_PATH_SEGMENT = "/evidence/";
const EVIDENCE_ARTIFACT_FILE_SEGMENT = "/artifacts/";
const JIRA_ATTACHMENT_PATH_SEGMENT = "/jira/attachments/";
const KB_ASSET_PATH_SEGMENT = "/kb/repos/";
const KB_ASSET_FILE_SEGMENT = "/assets/";
const GITHUB_ASSET_PATH_SEGMENT = "/github/assets/";

/**
 * Builds the authenticated tracker API path that serves a stored project
 * attachment (e.g. `uploads/<id>.png`).
 */
export function projectAttachmentUrl(projectSlug: string, relativePath: string): string {
  const slug = requireProjectSlug(projectSlug);

  const path = requireNonBlank(relativePath.trim().replace(/^\/+/, ""), "attachment path");

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
  const slug = requireProjectSlug(projectSlug);
  const id = requireNonBlank(attachmentId, "attachmentId");

  return trackerPath(`/projects/${encodeURIComponent(slug)}/jira/attachments/${encodeURIComponent(id)}`);
}

/**
 * Deletes a JIRA issue attachment by id.
 */
export async function deleteJiraAttachment(projectSlug: string, attachmentId: string): Promise<void> {
  await http.delete(jiraAttachmentUrl(projectSlug, attachmentId));
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

/**
 * True when a URL points at a Symphony evidence artifact endpoint, which
 * requires an Authorization header and therefore cannot be rendered by a plain
 * <img src> or <video src>.
 */
export function isEvidenceArtifactUrl(src: string | null | undefined): boolean {
  if (typeof src !== "string" || src.length === 0) return false;
  if (/^(data:|blob:)/i.test(src)) return false;

  const path = src.replace(/^https?:\/\/[^/]+/i, "");
  return (
    path.includes(`${API_PREFIX}/projects/`) &&
    path.includes(EVIDENCE_ARTIFACT_PATH_SEGMENT) &&
    path.includes(EVIDENCE_ARTIFACT_FILE_SEGMENT)
  );
}

/**
 * True when a URL points at the JIRA attachment proxy endpoint, which the daemon
 * serves with the operator's credentials behind a bearer-authenticated route and
 * therefore cannot be rendered by a plain <img src> or <video src>.
 */
export function isJiraAttachmentUrl(src: string | null | undefined): boolean {
  if (typeof src !== "string" || src.length === 0) return false;
  if (/^(data:|blob:)/i.test(src)) return false;

  const path = src.replace(/^https?:\/\/[^/]+/i, "");
  return (
    path.includes(`${API_PREFIX}/projects/`) && path.includes(JIRA_ATTACHMENT_PATH_SEGMENT)
  );
}

export function isKbAssetUrl(src: string | null | undefined): boolean {
  if (typeof src !== "string" || src.length === 0) return false;
  if (/^(data:|blob:)/i.test(src)) return false;

  const path = src.replace(/^https?:\/\/[^/]+/i, "");
  return (
    (path.includes(`${API_PREFIX}${KB_ASSET_PATH_SEGMENT}`) || path.includes(KB_ASSET_PATH_SEGMENT)) &&
    path.includes(KB_ASSET_FILE_SEGMENT)
  );
}

/**
 * True when a URL points at the Symphony GitHub asset proxy endpoint, which
 * streams a managed `symphony-assets` attachment with the operator's GitHub token
 * and therefore cannot be rendered by a plain <img src> or <video src>.
 */
export function isGitHubAssetUrl(src: string | null | undefined): boolean {
  if (typeof src !== "string" || src.length === 0) return false;
  if (/^(data:|blob:)/i.test(src)) return false;

  const path = src.replace(/^https?:\/\/[^/]+/i, "");
  return (
    path.includes(`${API_PREFIX}/projects/`) && path.includes(GITHUB_ASSET_PATH_SEGMENT)
  );
}

/** Tracker-hosted media that must be fetched with the bearer token. */
export function isTrackerAuthenticatedMediaUrl(src: string | null | undefined): boolean {
  return (
    isInternalAttachmentUrl(src) ||
    isEvidenceArtifactUrl(src) ||
    isJiraAttachmentUrl(src) ||
    isKbAssetUrl(src) ||
    isGitHubAssetUrl(src)
  );
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
 * Absolute tracker API URLs may use a different loopback hostname than the page
 * (127.0.0.1 vs localhost). Rewriting them to a same-origin path avoids CORS
 * preflight on bearer-authenticated media fetches.
 */
export function toSameOriginTrackerRequestUrl(src: string): string {
  if (!/^https?:\/\//i.test(src)) return src;

  try {
    const url = new URL(src);
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) return src;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return src;
  }
}

/**
 * Fetches an attachment with the tracker bearer token and returns a blob object
 * URL suitable for an <img src>. Results are cached per source so repeated
 * renders reuse a single object URL for the lifetime of the page.
 */
export function fetchAttachmentObjectUrl(src: string): Promise<string> {
  requireNonBlank(src, "attachment src");

  const cached = objectUrlCache.get(src);
  if (cached) return cached;

  const pending = http
    .get(toSameOriginTrackerRequestUrl(src), { responseType: "blob" })
    .then((response) => URL.createObjectURL(response.data as Blob))
    .catch((cause) => {
      objectUrlCache.delete(src);
      throw cause;
    });

  objectUrlCache.set(src, pending);
  return pending;
}
