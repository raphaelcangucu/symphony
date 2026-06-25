import type { TFunction } from "i18next";

import { i18n } from "@/i18n";
import { issueAssistantPath, issuePath, projectExploreAssistantPath, withAgentSection } from "@/lib/workspaceRoutes";
import type { RecentSession } from "@/types/recents";

export function recentSessionSubtitle(
  session: RecentSession,
  t: TFunction = i18n.t.bind(i18n) as TFunction,
): string {
  if (session.kind === "codex") {
    return [session.identifier, session.projectName ?? session.projectSlug].filter(Boolean).join(" · ");
  }

  if (session.scope === "issue") {
    return [session.identifier, session.projectName ?? session.projectSlug].filter(Boolean).join(" · ");
  }

  if (session.scope === "freeform") return t("layout.sessionSubtitle.freeform");
  if (session.scope === "project_explore") {
    return session.projectName ?? session.projectSlug ?? t("layout.sessionSubtitle.explore");
  }

  return session.projectName ?? session.projectSlug ?? t("layout.sessionSubtitle.projectChat");
}

export function recentSessionPath(session: RecentSession): string {
  if (session.kind === "codex") {
    if (session.projectSlug && session.identifier) {
      return withAgentSection(
        issuePath(session.projectSlug, "board", session.identifier, "agent"),
        "",
        "execution",
      );
    }
    return session.projectSlug ? `/projects/${session.projectSlug}/board` : "/projects";
  }

  if (session.scope === "issue" && session.projectSlug && session.identifier) {
    return issueAssistantPath(session.projectSlug, session.identifier);
  }

  if (session.scope === "freeform") {
    return session.threadId != null ? `/assistant/${session.threadId}` : "/assistant";
  }

  if (session.scope === "project_explore" && session.projectSlug) {
    return projectExploreAssistantPath(session.projectSlug);
  }

  if (session.projectSlug) {
    return `/projects/${session.projectSlug}/assistant`;
  }

  return "/assistant";
}
