import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { TerminalSession } from "@/types/terminal";

import { http, trackerPath, unwrapData } from "./http";

interface BackendTerminalSessionDto {
  project_slug: string;
  issue_identifier: string;
  state: TerminalSession["state"];
  session_name: string | null;
  cwd: string | null;
  channel_topic: string;
  message?: string | null;
}

export function terminalTopic(projectSlug: string, issueIdentifier: string): string {
  const slug = requireProjectSlug(projectSlug);
  const identifier = requireNonBlank(issueIdentifier, "issueIdentifier");
  return `terminal:${slug}:${identifier}`;
}

export function devenvTerminalTopic(projectSlug: string): string {
  const slug = requireProjectSlug(projectSlug);
  return `terminal:devenv:${slug}`;
}

export async function openTerminalSession(projectSlug: string, issueIdentifier: string): Promise<TerminalSession> {
  const slug = requireProjectSlug(projectSlug);
  const identifier = requireNonBlank(issueIdentifier, "issueIdentifier");

  const response = await http.post(
    trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(identifier)}/terminal`,
    ),
  );

  return normalizeTerminalSession(unwrapData<BackendTerminalSessionDto>(response));
}

function normalizeTerminalSession(session: BackendTerminalSessionDto): TerminalSession {
  return {
    issueIdentifier: session.issue_identifier,
    projectSlug: session.project_slug,
    state: session.state,
    sessionName: session.session_name,
    cwd: session.cwd,
    channelTopic: session.channel_topic,
    message: session.message ?? null,
  };
}
