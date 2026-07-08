import type { TFunction } from "i18next";

import { i18n } from "@/i18n";
import {
  projectAuthoringSessionPath,
  projectExecutionSessionPath,
  projectExploreAssistantPath,
  projectSessionPath,
} from "@/lib/workspaceRoutes";
import type { RecentSession } from "@/types/recents";

export function recentSessionSubtitle(
  session: RecentSession,
  t: TFunction = i18n.t.bind(i18n) as TFunction,
): string {
  if (session.kind === "codex") {
    return [session.identifier, session.projectName ?? session.projectSlug].filter(Boolean).join(" · ");
  }

  if (session.scope === "issue" || session.scope === "issue_session") {
    return [session.identifier, session.projectName ?? session.projectSlug].filter(Boolean).join(" · ");
  }

  if (session.scope === "freeform") return t("layout.sessionSubtitle.freeform");
  if (session.scope === "project_session") {
    return [session.projectName ?? session.projectSlug, session.threadId ? `#${session.threadId}` : null].filter(Boolean).join(" · ");
  }

  if (session.scope === "project_explore") {
    return session.projectName ?? session.projectSlug ?? t("layout.sessionSubtitle.explore");
  }

  return session.projectName ?? session.projectSlug ?? t("layout.sessionSubtitle.projectChat");
}

export function recentSessionPath(session: RecentSession): string {
  if (session.kind === "codex") {
    if (session.projectSlug && session.identifier) {
      return projectExecutionSessionPath(session.projectSlug, session.identifier);
    }
    return session.projectSlug ? `/projects/${session.projectSlug}/board` : "/projects";
  }

  if (session.scope === "issue" && session.projectSlug && session.identifier) {
    return withAssistantAgent(projectAuthoringSessionPath(session.projectSlug, session.identifier), session);
  }

  if (session.scope === "issue_session" && session.projectSlug && session.threadId != null) {
    return withAssistantAgent(projectSessionPath(session.projectSlug, session.threadId), session);
  }

  if (session.scope === "freeform") {
    return withAssistantAgent(session.threadId != null ? `/assistant/${session.threadId}` : "/assistant", session);
  }

  if (session.scope === "project_explore" && session.projectSlug) {
    return withAssistantAgent(projectExploreAssistantPath(session.projectSlug), session);
  }

  if (session.scope === "project_session" && session.projectSlug && session.threadId != null) {
    return withAssistantAgent(projectSessionPath(session.projectSlug, session.threadId), session);
  }

  if (session.scope === "project" && session.projectSlug && session.threadId != null) {
    return withAssistantAgent(projectSessionPath(session.projectSlug, session.threadId), session);
  }

  if (session.projectSlug) {
    return withAssistantAgent(`/projects/${session.projectSlug}/assistant`, session);
  }

  return withAssistantAgent("/assistant", session);
}

function withAssistantAgent(path: string, session: RecentSession): string {
  const agent = session.agentKind;
  if (agent !== "codex" && agent !== "claude" && agent !== "cursor") return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}assistant_agent=${encodeURIComponent(agent)}`;
}
