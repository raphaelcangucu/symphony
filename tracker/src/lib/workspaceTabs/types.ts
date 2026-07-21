export type WorkspaceTabKind =
  | "issue-terminal"
  | "thread-terminal"
  | "project-terminal"
  | "dynamic-terminal"
  | "assistant-session"
  | "authoring-session"
  | "new-issue"
  | "sessions-list";

export interface WorkspaceTabBase {
  id: string;
  kind: WorkspaceTabKind;
  title: string;
  closable: boolean;
}

export interface IssueTerminalTab extends WorkspaceTabBase {
  kind: "issue-terminal";
  issueIdentifier: string;
}

export interface ThreadTerminalTab extends WorkspaceTabBase {
  kind: "thread-terminal";
  threadId: number;
}

export interface ProjectTerminalTab extends WorkspaceTabBase {
  kind: "project-terminal";
  projectSlug: string;
}

export interface DynamicTerminalTab extends WorkspaceTabBase {
  kind: "dynamic-terminal";
  tabId: string;
  issueIdentifier: string;
}

export interface AssistantSessionTab extends WorkspaceTabBase {
  kind: "assistant-session";
  threadId: number;
}

export interface AuthoringSessionTab extends WorkspaceTabBase {
  kind: "authoring-session";
  issueIdentifier: string;
}

export interface SessionsListTab extends WorkspaceTabBase {
  kind: "sessions-list";
}

export interface NewIssueTab extends WorkspaceTabBase {
  kind: "new-issue";
}

export type WorkspaceTab =
  | IssueTerminalTab
  | ThreadTerminalTab
  | ProjectTerminalTab
  | DynamicTerminalTab
  | AssistantSessionTab
  | AuthoringSessionTab
  | NewIssueTab
  | SessionsListTab;

export interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeTabId: string;
}

export function issueTerminalTabId(issueIdentifier: string): string {
  return `issue-terminal:${issueIdentifier.trim()}`;
}

export function threadTerminalTabId(threadId: number): string {
  if (!Number.isInteger(threadId) || threadId <= 0) {
    throw new Error("threadId must be a positive integer");
  }
  return `thread-terminal:${threadId}`;
}

export function projectTerminalTabId(projectSlug: string): string {
  return `project-terminal:${projectSlug.trim()}`;
}

export function dynamicTerminalTabId(tabId: string): string {
  const id = tabId.trim();
  if (!id) throw new Error("tabId is required");
  return `dynamic-terminal:${id}`;
}

export function assistantSessionTabId(threadId: number): string {
  if (!Number.isInteger(threadId) || threadId <= 0) {
    throw new Error("threadId must be a positive integer");
  }
  return `assistant-session:${threadId}`;
}

export function authoringSessionTabId(issueIdentifier: string): string {
  const identifier = issueIdentifier.trim();
  if (!identifier) throw new Error("issueIdentifier is required");
  return `authoring-session:${identifier}`;
}

export const SESSIONS_LIST_TAB_ID = "sessions-list";

/** Stable id: only one ephemeral new-issue tab per project workspace. */
export const NEW_ISSUE_TAB_ID = "new-issue";

export function createIssueTerminalTab(issueIdentifier: string, title: string): IssueTerminalTab {
  const identifier = issueIdentifier.trim();
  if (!identifier) throw new Error("issueIdentifier is required");
  return {
    id: issueTerminalTabId(identifier),
    kind: "issue-terminal",
    title: title.trim() || identifier,
    closable: false,
    issueIdentifier: identifier,
  };
}

export function createThreadTerminalTab(threadId: number, title: string): ThreadTerminalTab {
  return {
    id: threadTerminalTabId(threadId),
    kind: "thread-terminal",
    title: title.trim() || `Thread ${threadId}`,
    closable: false,
    threadId,
  };
}

export function createProjectTerminalTab(projectSlug: string, title: string): ProjectTerminalTab {
  const slug = projectSlug.trim();
  if (!slug) throw new Error("projectSlug is required");
  return {
    id: projectTerminalTabId(slug),
    kind: "project-terminal",
    title: title.trim() || slug,
    closable: false,
    projectSlug: slug,
  };
}

export function createDynamicTerminalTab(tabId: string, issueIdentifier: string, title: string): DynamicTerminalTab {
  const id = tabId.trim();
  const identifier = issueIdentifier.trim();
  if (!id) throw new Error("tabId is required");
  if (!identifier) throw new Error("issueIdentifier is required");
  return {
    id: dynamicTerminalTabId(id),
    kind: "dynamic-terminal",
    title: title.trim() || id,
    closable: true,
    tabId: id,
    issueIdentifier: identifier,
  };
}

export function createAssistantSessionTab(threadId: number, title: string): AssistantSessionTab {
  return {
    id: assistantSessionTabId(threadId),
    kind: "assistant-session",
    title: title.trim() || `Session ${threadId}`,
    closable: true,
    threadId,
  };
}

export function createAuthoringSessionTab(issueIdentifier: string, title: string): AuthoringSessionTab {
  const identifier = issueIdentifier.trim();
  if (!identifier) throw new Error("issueIdentifier is required");
  const trimmedTitle = title.trim() || identifier;
  return {
    id: authoringSessionTabId(identifier),
    kind: "authoring-session",
    title: trimmedTitle,
    closable: true,
    issueIdentifier: identifier,
  };
}

export function createSessionsListTab(title: string): SessionsListTab {
  return {
    id: SESSIONS_LIST_TAB_ID,
    kind: "sessions-list",
    title: title.trim() || "Sessions",
    closable: false,
  };
}

export function createNewIssueTab(title: string): NewIssueTab {
  return {
    id: NEW_ISSUE_TAB_ID,
    kind: "new-issue",
    title: title.trim() || "New issue",
    closable: true,
  };
}
