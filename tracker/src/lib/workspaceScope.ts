export type WorkspaceScope =
  | {
      kind: "issue";
      projectSlug: string;
      issueIdentifier: string;
      threadId?: number;
    }
  | {
      kind: "thread";
      projectSlug: string;
      threadId: number;
      workspacePath: string | null;
    };

export function issueWorkspaceScope(
  projectSlug: string,
  issueIdentifier: string,
  threadId?: number,
): WorkspaceScope {
  const scope: WorkspaceScope = {
    kind: "issue",
    projectSlug: projectSlug.trim(),
    issueIdentifier: issueIdentifier.trim(),
  };
  if (threadId != null && Number.isInteger(threadId) && threadId > 0) {
    return { ...scope, threadId };
  }
  return scope;
}

export function threadWorkspaceScope(
  projectSlug: string,
  threadId: number,
  workspacePath: string | null,
): WorkspaceScope {
  if (!Number.isInteger(threadId) || threadId <= 0) {
    throw new Error("threadId must be a positive integer");
  }
  return {
    kind: "thread",
    projectSlug: projectSlug.trim(),
    threadId,
    workspacePath: workspacePath?.trim() || null,
  };
}

export function workspaceScopeKey(scope: WorkspaceScope): string {
  if (scope.kind === "issue") {
    return `issue:${scope.projectSlug}:${scope.issueIdentifier}`;
  }
  return `thread:${scope.projectSlug}:${scope.threadId}`;
}

export function workspaceScopeLabel(scope: WorkspaceScope): string {
  if (scope.kind === "issue") return scope.issueIdentifier;
  return scope.workspacePath?.split("/").filter(Boolean).at(-1) || `thread-${scope.threadId}`;
}

export function workspaceScopesEqual(
  a: WorkspaceScope | null | undefined,
  b: WorkspaceScope | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  return workspaceScopeKey(a) === workspaceScopeKey(b);
}

export function workspaceScopeProvisioned(scope: WorkspaceScope): boolean {
  if (scope.kind === "issue") return scope.issueIdentifier.length > 0;
  return Boolean(scope.workspacePath);
}
