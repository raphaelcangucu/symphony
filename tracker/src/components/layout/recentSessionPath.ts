import type { RecentSession } from "@/types/recents";

export function recentSessionPath(session: RecentSession): string {
  if (session.kind === "codex") {
    if (session.projectSlug && session.identifier) {
      return `/projects/${session.projectSlug}/board/issues/${session.identifier}`;
    }
    return session.projectSlug ? `/projects/${session.projectSlug}/board` : "/projects";
  }

  if (session.scope === "freeform") {
    return session.threadId != null ? `/assistant/${session.threadId}` : "/assistant";
  }

  if (session.projectSlug) {
    return `/projects/${session.projectSlug}/assistant`;
  }

  return "/assistant";
}
