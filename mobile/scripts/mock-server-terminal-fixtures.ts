export type MockTerminalTab = Record<string, unknown> & {
  id: string;
  terminal: string;
};

export function mockRepos(): Record<string, unknown>[] {
  return [
    {
      id: "symphony",
      displayName: "Dev10x Symphony",
      path: "/tmp/dev10x-mobile-mock/symphony",
      badgeColor: "#7c3aed",
      addedAt: Date.parse("2026-07-25T18:00:00Z"),
      kind: "git",
      executionHostId: "local",
    },
  ];
}

export function mockWorktrees(): Record<string, unknown>[] {
  return [
    {
      worktreeId: "101",
      id: "101",
      repoId: "symphony",
      repo: "symphony",
      branch: "feature/dev10x-mobile",
      displayName: "Dev10x mobile workspace",
      path: "/tmp/dev10x-mobile-mock/symphony",
      liveTerminalCount: 1,
      hasAttachedPty: true,
      preview: "Mock host connected through the production encrypted RPC client.",
      unread: false,
      isPinned: true,
      isActive: true,
      linkedPR: null,
      linkedIssue: {
        provider: "symphony",
        identifier: "DEV-101",
        title: "Connect the copied Dev10x mobile experience",
      },
      comment: "Standalone external mock over the production Symphony protocol.",
      status: "active",
      diffComments: [],
    },
  ];
}

export function mockPrimaryTerminalTab(threadId = 101): MockTerminalTab {
  const handle = `thread:${threadId}`;
  return {
    type: "terminal",
    id: handle,
    title: "Dev10x mobile",
    terminal: handle,
    launchAgent: "codex",
    status: "ready",
    isActive: true,
  };
}

export function mockSessionSnapshot(input: {
  hostId: string;
  threadId: number;
  tabs: MockTerminalTab[];
  activeTabId: string;
  snapshotVersion: number;
}): Record<string, unknown> {
  const primaryHandle = `thread:${input.threadId}`;
  const tabs =
    input.tabs.length > 0
      ? input.tabs
      : [{ ...mockPrimaryTerminalTab(input.threadId), id: primaryHandle, terminal: primaryHandle }];
  const activeTabId = tabs.some((tab) => tab.id === input.activeTabId)
    ? input.activeTabId
    : primaryHandle;
  return {
    worktree: String(input.threadId),
    publicationEpoch: `${input.hostId}:${input.threadId}`,
    snapshotVersion: input.snapshotVersion,
    tabs: tabs.map((tab) => ({ ...tab, isActive: tab.id === activeTabId })),
    activeTabId,
    activeTabType: "terminal",
  };
}

export function mockTerminalList(snapshot: Record<string, unknown>): Record<string, unknown> {
  const tabs = Array.isArray(snapshot.tabs) ? (snapshot.tabs as Record<string, unknown>[]) : [];
  const terminals = tabs.map((tab) => ({
    handle: tab.terminal,
    title: tab.title,
    isActive: tab.isActive,
    worktreeId: snapshot.worktree,
    hasRunningProcess: tab.status === "ready",
  }));
  return {
    terminals,
    totalCount: terminals.length,
    truncated: false,
  };
}

export function mockTerminalScrollback(input: {
  cols: number;
  rows: number;
  displayMode: "auto" | "desktop";
}): Record<string, unknown> {
  const lines = ["$ dev10x mobile --mock", "Dev10x mock host online", "Symphony RPC: encrypted"];
  return {
    type: "scrollback",
    serialized: `${lines.join("\n")}\n`,
    lines,
    truncated: false,
    cols: input.cols,
    rows: input.rows,
    displayMode: input.displayMode,
  };
}
