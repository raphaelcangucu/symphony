export function hostChatRoute(hostId: string, threadId: string | number, name?: string): string {
  return hostSessionRoute("chat", hostId, threadId, name);
}

export function hostTerminalRoute(
  hostId: string,
  threadId: string | number,
  name?: string,
): string {
  return hostSessionRoute("session", hostId, threadId, name);
}

export function assistantThreadDiffRoute(worktreeId: string): string | null {
  const threadId = Number(worktreeId);
  return Number.isInteger(threadId) && threadId > 0 ? `/session/${threadId}/diff` : null;
}

export function sessionNotificationRoute(
  hostId: string,
  threadId: string | number,
): string {
  return hostChatRoute(hostId, threadId);
}

export function hostWorktreeRoute(input: {
  hostId: string;
  threadId: string | number;
  name?: string;
  scope?: string;
  issueIdentifier?: string | null;
  agentKind?: string | null;
  status?: string;
}): string {
  if (input.scope !== "issue_execution") {
    return hostChatRoute(input.hostId, input.threadId, input.name);
  }

  const query = new URLSearchParams({
    identifier:
      input.issueIdentifier?.trim() || input.name?.trim() || `Run ${String(input.threadId)}`,
    ...(input.agentKind ? { agent: input.agentKind } : {}),
    status: orchestratorStatus(input.status),
  });
  return `/h/${encodeURIComponent(input.hostId)}/run/${encodeURIComponent(
    String(input.threadId),
  )}?${query.toString()}`;
}

function hostSessionRoute(
  surface: "chat" | "session",
  hostId: string,
  threadId: string | number,
  name?: string,
): string {
  const route = `/h/${encodeURIComponent(hostId)}/${surface}/${encodeURIComponent(
    String(threadId),
  )}`;
  return name ? `${route}?name=${encodeURIComponent(name)}` : route;
}

function orchestratorStatus(status: string | undefined): string {
  if (status === "working" || status === "active" || status === "permission") return "live";
  if (status === "done") return "saved";
  if (
    status === "live" ||
    status === "waiting" ||
    status === "retrying" ||
    status === "error" ||
    status === "aborted" ||
    status === "paused" ||
    status === "saved"
  ) {
    return status;
  }
  return "idle";
}
