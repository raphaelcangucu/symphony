import type { SessionStatusIconKind } from "@/components/shared/ChatStatusIcon";
import type { ExecutionMode } from "@/types/issue";
import type { RecentStatusKind } from "@/types/recents";
import type { SidebarAggregateStatus } from "@/types/sidebar";

import type { WorkspaceTab } from "./types";

export interface WorkspaceTabStatusIcon {
  sessionKind: SessionStatusIconKind;
  executionMode?: ExecutionMode | null;
  statusKind?: RecentStatusKind | null;
  aggregateStatus?: SidebarAggregateStatus | null;
  needsAttention?: boolean;
}

export interface WorkspaceTabPresentationContext {
  threadIssueIdentifiers: ReadonlyMap<number, string>;
  issueTitles: ReadonlyMap<string, string>;
  threadStatusIcons?: ReadonlyMap<number, WorkspaceTabStatusIcon>;
}

export interface WorkspaceTabPresentation {
  label: string;
  tooltip?: string;
  statusIcon?: WorkspaceTabStatusIcon | null;
}

export function resolveIssueLinkedTabTitle(
  issueIdentifier: string | null | undefined,
  fallbackTitle: string,
): string {
  const title = fallbackTitle.trim();
  if (title) return title;
  const identifier = issueIdentifier?.trim();
  if (identifier) return identifier;
  return "Session";
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
  const sessionTitle = tab.title.trim();
  const statusIcon =
    tab.kind === "assistant-session"
      ? (context.threadStatusIcons?.get(tab.threadId) ?? null)
      : null;

  if (!issueIdentifier) {
    return { label: sessionTitle || tab.title, statusIcon };
  }

  const issueTitle = context.issueTitles.get(issueIdentifier)?.trim() || null;
  const label = sessionTitle || issueIdentifier || "Session";

  const tooltipParts: string[] = [];
  if (issueIdentifier && !label.includes(issueIdentifier)) {
    tooltipParts.push(issueIdentifier);
  }
  if (issueTitle && issueTitle !== issueIdentifier && !label.includes(issueTitle)) {
    tooltipParts.push(issueTitle);
  }

  return {
    label,
    tooltip: tooltipParts.length > 0 ? tooltipParts.join(" · ") : undefined,
    statusIcon,
  };
}
