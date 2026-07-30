import type { ProjectSessionRow } from "@/api/contracts";
import type { Worktree } from "@/dev10x/worktree/workspace-list-types";

export type ProjectWorkspace = {
  key: string;
  path: string;
  title: string;
  subtitle: string;
  threadId: number;
  status: string | null;
  scope: string;
  issueIdentifier: string | null;
  agentKind: ProjectSessionRow["agentKind"];
};

export function selectProjectWorkspaces(
  sessions: ProjectSessionRow[],
  worktrees: Worktree[],
): ProjectWorkspace[] {
  const worktreesByPath = new Map(worktrees.map((worktree) => [worktree.path, worktree]));
  const sessionsByPath = new Map<string, ProjectSessionRow[]>();

  for (const session of sessions) {
    if (!session.workspacePath || session.threadId == null) continue;
    const workspaceSessions = sessionsByPath.get(session.workspacePath) ?? [];
    workspaceSessions.push(session);
    sessionsByPath.set(session.workspacePath, workspaceSessions);
  }

  return [...sessionsByPath.entries()].map(([path, workspaceSessions]) => {
    const latest = workspaceSessions[0]!;
    const worktree = worktreesByPath.get(path);
    const sessionCount = workspaceSessions.length;
    const repository =
      worktree?.repo && worktree?.branch ? `${worktree.repo} · ${worktree.branch} · ` : "";

    return {
      key: path,
      path,
      title: worktree?.displayName?.trim() || pathName(path),
      subtitle: `${repository}${sessionCount} ${sessionCount === 1 ? "sessão" : "sessões"}`,
      threadId: latest.threadId!,
      status: latest.aggregateStatus ?? worktree?.status ?? null,
      scope: latest.scope,
      issueIdentifier: latest.issueIdentifier,
      agentKind: latest.agentKind,
    };
  });
}

function pathName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}
