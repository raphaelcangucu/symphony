export function hostChatRoute(
  hostId: string,
  threadId: string | number,
  name?: string,
): string {
  return hostSessionRoute("chat", hostId, threadId, name);
}

export function hostTerminalRoute(
  hostId: string,
  threadId: string | number,
  name?: string,
): string {
  const route = hostSessionRoute("session", hostId, threadId, name);
  return `${route}${route.includes("?") ? "&" : "?"}view=terminal`;
}

export function assistantThreadDiffRoute(
  threadIdInput: string | number,
  hostId?: string | null,
): string | null {
  const threadId = Number(threadIdInput);
  if (!Number.isInteger(threadId) || threadId <= 0) return null;
  return hostId
    ? `/session/${threadId}/diff?hostId=${encodeURIComponent(hostId)}`
    : `/session/${threadId}/diff`;
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
  projectSlug?: string | null;
  agentKind?: string | null;
  status?: string;
}): string {
  if (input.scope !== "issue_execution") {
    return hostChatRoute(input.hostId, input.threadId, input.name);
  }

  const query = new URLSearchParams({
    identifier:
      input.issueIdentifier?.trim() ||
      input.name?.trim() ||
      `Run ${String(input.threadId)}`,
    ...(input.agentKind ? { agent: input.agentKind } : {}),
    // Keep the task context in the execution deep link. `project` is also used
    // by some router integrations, so use a specific query key and keep the
    // route independent from the best-effort session-context RPC.
    ...(input.projectSlug?.trim()
      ? { projectSlug: input.projectSlug.trim() }
      : {}),
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
  if (status === "working" || status === "active" || status === "permission")
    return "live";
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
