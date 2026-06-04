import { http, trackerPath, unwrapData } from "./http";

export type EditorReason =
  | "disabled"
  | "starting"
  | "unavailable"
  | "workspace_missing"
  | "workspace_skills_unavailable";

export interface EditorTarget {
  available: boolean;
  url: string | null;
  reason: EditorReason | null;
}

export interface EditorTargets {
  browser: EditorTarget;
  cursorDesktop: EditorTarget;
}

interface BackendEditorDto {
  available?: boolean | null;
  url?: string | null;
  reason?: string | null;
  cursor_desktop?: BackendEditorDto | null;
}

const REASONS: readonly EditorReason[] = [
  "disabled",
  "starting",
  "unavailable",
  "workspace_missing",
  "workspace_skills_unavailable",
];

function normalizeReason(value: string | null | undefined): EditorReason | null {
  if (typeof value === "string" && (REASONS as readonly string[]).includes(value)) {
    return value as EditorReason;
  }
  return null;
}

function mapEditorTarget(dto: BackendEditorDto): EditorTarget {
  const available = dto.available ?? false;

  return {
    available,
    url: available ? dto.url ?? null : null,
    reason: available ? null : normalizeReason(dto.reason),
  };
}

/** Build a cursor:// URL from a code-server link (?folder= or ?workspace=). */
export function buildCursorUrlFromCodeServerUrl(codeServerUrl: string): string | null {
  try {
    const url = new URL(codeServerUrl);
    const folder = url.searchParams.get("folder") ?? url.searchParams.get("workspace");
    if (!folder) return null;
    const path = decodeURIComponent(folder).replace(/\\/g, "/");
    return `cursor://file/${encodeURI(path)}`;
  } catch {
    return null;
  }
}

function resolveCursorDesktop(dto: BackendEditorDto, browser: EditorTarget): EditorTarget {
  if (dto.cursor_desktop) {
    return mapEditorTarget(dto.cursor_desktop);
  }

  // Back-compat: older Symphony builds only return the browser target.
  const derivedUrl = browser.url ? buildCursorUrlFromCodeServerUrl(browser.url) : null;
  if (derivedUrl) {
    return { available: true, url: derivedUrl, reason: null };
  }

  return { available: false, url: null, reason: browser.reason ?? "unavailable" };
}

export async function fetchEditorTargets(projectSlug: string, identifier: string): Promise<EditorTargets> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");

  const response = await http.get(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/editor`),
  );

  const dto = unwrapData<BackendEditorDto>(response);
  const browser = mapEditorTarget(dto);
  const cursorDesktop = resolveCursorDesktop(dto, browser);

  return { browser, cursorDesktop };
}

/** @deprecated Use fetchEditorTargets — returns the browser (code-server) target only. */
export async function fetchEditorTarget(projectSlug: string, identifier: string): Promise<EditorTarget> {
  const targets = await fetchEditorTargets(projectSlug, identifier);
  return targets.browser;
}
