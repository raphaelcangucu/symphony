import type { WorkspaceTab } from "./types";

export interface WorkspaceTabPresentationContext {
  threadIssueIdentifiers: ReadonlyMap<number, string>;
  issueTitles: ReadonlyMap<string, string>;
}

export interface WorkspaceTabPresentation {
  label: string;
  tooltip?: string;
}

export function resolveIssueLinkedTabTitle(
  issueIdentifier: string | null | undefined,
  fallbackTitle: string,
): string {
  const identifier = issueIdentifier?.trim();
  if (identifier) return identifier;
  return fallbackTitle.trim() || fallbackTitle;
}

export function resolveSidebarSessionPresentation(
  sessionTitle: string,
  issueIdentifier: string | null | undefined,
): string {
  const identifier = issueIdentifier?.trim();
  const title = sessionTitle.trim();
  if (!identifier) {
    return title || "Session";
  }
  if (!title || title === identifier) {
    return identifier;
  }
  return `${identifier} - ${title}`;
}

export function promoteSelectedSidebarSession<T extends { id: string }>(
  sessions: readonly T[],
  preferredSessionId: string | null | undefined,
): readonly T[] {
  const id = preferredSessionId?.trim();
  if (!id) return sessions;
  const index = sessions.findIndex((session) => session.id === id);
  if (index <= 0) return sessions;
  const selected = sessions[index];
  return [selected, ...sessions.slice(0, index), ...sessions.slice(index + 1)];
}

export function getIssueIdentifierForTab(
  tab: WorkspaceTab,
  context: WorkspaceTabPresentationContext,
): string | null {
  switch (tab.kind) {
    case "authoring-session":
    case "issue-terminal":
    case "dynamic-terminal":
      return tab.issueIdentifier.trim() || null;
    case "assistant-session":
      return context.threadIssueIdentifiers.get(tab.threadId) ?? null;
    default:
      return null;
  }
}

export function resolveWorkspaceTabPresentation(
  tab: WorkspaceTab,
  context: WorkspaceTabPresentationContext,
): WorkspaceTabPresentation {
  const issueIdentifier = getIssueIdentifierForTab(tab, context);
  if (!issueIdentifier) {
    return { label: tab.title };
  }

  const issueTitle = context.issueTitles.get(issueIdentifier)?.trim() || null;
  const label = issueIdentifier;
  const tooltipParts = [issueIdentifier];

  if (issueTitle && issueTitle !== issueIdentifier) {
    tooltipParts.push(issueTitle);
  }
  if (tab.title.trim() && tab.title !== issueIdentifier && tab.title !== issueTitle) {
    tooltipParts.push(tab.title);
  }

  return {
    label,
    tooltip: tooltipParts.length > 1 ? tooltipParts.join(" · ") : undefined,
  };
}
