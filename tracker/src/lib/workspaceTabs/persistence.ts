import type { WorkspaceTab, WorkspaceTabsState } from "./types";

const STORAGE_PREFIX = "symphony:workspace-tabs:";

export function workspaceTabsStorageKey(scope: string, projectSlug: string): string {
  const normalizedScope = scope.trim();
  const normalizedSlug = projectSlug.trim();
  if (!normalizedScope) throw new Error("scope is required");
  if (!normalizedSlug) throw new Error("projectSlug is required");
  return `${STORAGE_PREFIX}${normalizedScope}:${normalizedSlug}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseWorkspaceTab(value: unknown): WorkspaceTab | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.kind !== "string" || typeof value.title !== "string") {
    return null;
  }

  const closable = value.closable === true;

  switch (value.kind) {
    case "issue-terminal":
      return typeof value.issueIdentifier === "string" && value.issueIdentifier.trim().length > 0
        ? {
            id: value.id,
            kind: "issue-terminal",
            title: value.title,
            closable,
            issueIdentifier: value.issueIdentifier.trim(),
          }
        : null;
    case "project-terminal":
      return typeof value.projectSlug === "string" && value.projectSlug.trim().length > 0
        ? {
            id: value.id,
            kind: "project-terminal",
            title: value.title,
            closable,
            projectSlug: value.projectSlug.trim(),
          }
        : null;
    case "dynamic-terminal":
      return typeof value.tabId === "string" &&
        value.tabId.trim().length > 0 &&
        typeof value.issueIdentifier === "string" &&
        value.issueIdentifier.trim().length > 0
        ? {
            id: value.id,
            kind: "dynamic-terminal",
            title: value.title,
            closable,
            tabId: value.tabId.trim(),
            issueIdentifier: value.issueIdentifier.trim(),
          }
        : null;
    case "assistant-session":
      return typeof value.threadId === "number" && Number.isInteger(value.threadId) && value.threadId > 0
        ? {
            id: value.id,
            kind: "assistant-session",
            title: value.title,
            closable,
            threadId: value.threadId,
          }
        : null;
    case "sessions-list":
      return {
        id: value.id,
        kind: "sessions-list",
        title: value.title,
        closable,
      };
    default:
      return null;
  }
}

export function readPersistedWorkspaceTabs(storageKey: string): WorkspaceTabsState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.tabs)) return null;

    const tabs = parsed.tabs
      .map(parseWorkspaceTab)
      .filter((tab): tab is WorkspaceTab => tab !== null);

    if (tabs.length === 0) return null;

    const activeTabId = typeof parsed.activeTabId === "string" ? parsed.activeTabId : tabs[0]?.id ?? "";
    return { tabs, activeTabId };
  } catch {
    return null;
  }
}

export function writePersistedWorkspaceTabs(storageKey: string, state: WorkspaceTabsState): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Ignore quota or privacy-mode failures.
  }
}
