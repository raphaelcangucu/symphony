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
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!issueIdentifier.trim()) throw new Error("issueIdentifier is required");
  return `terminal:${projectSlug}:${issueIdentifier}`;
}

export async function openTerminalSession(projectSlug: string, issueIdentifier: string): Promise<TerminalSession> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!issueIdentifier.trim()) throw new Error("issueIdentifier is required");

  const response = await http.post(
    trackerPath(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(issueIdentifier)}/terminal`,
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
