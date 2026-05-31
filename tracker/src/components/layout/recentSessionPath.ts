import { issueAssistantPath } from "@/lib/workspaceRoutes";
import type { RecentSession } from "@/types/recents";

export function recentSessionSubtitle(session: RecentSession): string {
  if (session.kind === "codex") {
    return [session.identifier, session.projectName ?? session.projectSlug].filter(Boolean).join(" · ");
  }

  if (session.scope === "issue") {
    return [session.identifier, session.projectName ?? session.projectSlug].filter(Boolean).join(" · ");
  }

  if (session.scope === "freeform") return "Freeform chat";

  return session.projectName ?? session.projectSlug ?? "Project chat";
}

export function recentSessionPath(session: RecentSession): string {
  if (session.kind === "codex") {
    if (session.projectSlug && session.identifier) {
      return `/projects/${session.projectSlug}/board/issues/${session.identifier}`;
    }
    return session.projectSlug ? `/projects/${session.projectSlug}/board` : "/projects";
  }

  if (session.scope === "issue" && session.projectSlug && session.identifier) {
    return issueAssistantPath(session.projectSlug, session.identifier);
  }

  if (session.scope === "freeform") {
    return session.threadId != null ? `/assistant/${session.threadId}` : "/assistant";
  }

  if (session.projectSlug) {
    return `/projects/${session.projectSlug}/assistant`;
  }

  return "/assistant";
}
