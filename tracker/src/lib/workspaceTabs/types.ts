export type WorkspaceTabKind =
  | "issue-terminal"
  | "project-terminal"
  | "dynamic-terminal"
  | "assistant-session"
  | "execution-session"
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

export interface ExecutionSessionTab extends WorkspaceTabBase {
  kind: "execution-session";
  issueIdentifier: string;
}

export interface SessionsListTab extends WorkspaceTabBase {
  kind: "sessions-list";
}

export type WorkspaceTab =
  | IssueTerminalTab
  | ProjectTerminalTab
  | DynamicTerminalTab
  | AssistantSessionTab
  | ExecutionSessionTab
  | SessionsListTab;

export interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeTabId: string;
}

export function issueTerminalTabId(issueIdentifier: string): string {
  return `issue-terminal:${issueIdentifier.trim()}`;
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

export function executionSessionTabId(issueIdentifier: string): string {
  const identifier = issueIdentifier.trim();
  if (!identifier) throw new Error("issueIdentifier is required");
  return `execution-session:${identifier}`;
}

export const SESSIONS_LIST_TAB_ID = "sessions-list";

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

export function createExecutionSessionTab(issueIdentifier: string, title: string): ExecutionSessionTab {
  const identifier = issueIdentifier.trim();
  if (!identifier) throw new Error("issueIdentifier is required");
  return {
    id: executionSessionTabId(identifier),
    kind: "execution-session",
    title: title.trim() || identifier,
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
