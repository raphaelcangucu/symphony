import type { AgentExecution } from "@/types/agent-execution";
import type { IssueDevServer, IssueDevServerReason, IssueDevServersResponse } from "@/types/issue";

export type PreviewAssistantHandoffTarget = "authoring" | "execution-steer";

export interface PreviewAssistantHandoff {
  projectSlug: string;
  issueIdentifier: string;
  target: PreviewAssistantHandoffTarget;
  message: string;
  createdAt: number;
}

const STORAGE_KEY = "symphony:preview-assistant-handoff";

export function buildPreviewFailurePrompt(
  snapshot: IssueDevServersResponse,
  server?: IssueDevServer | null,
): string {
  const lines = [
    "The issue preview dev server failed. Diagnose the workspace, fix the root cause, and tell me when Start Preview should work again.",
    "",
    `Availability: ${snapshot.available ? "available" : "unavailable"}`,
  ];

  if (snapshot.reason) {
    lines.push(`Availability reason: ${snapshot.reason}`);
  }

  if (server) {
    lines.push("");
    lines.push(`Failed server: ${server.slug}`);
    lines.push(`Status: ${server.status}`);
    if (server.working_dir) lines.push(`Working directory: ${server.working_dir}`);
    if (server.port != null) lines.push(`Port: ${server.port}`);
    if (server.session_name) {
      lines.push(`Tmux session: ${server.session_name}`);
      lines.push(`Inspect logs: tmux capture-pane -t ${server.session_name} -p -S -80`);
    }
  }

  lines.push("");
  lines.push(
    "Check setup/serve DevEnv steps, run missing installs (for example npm ci in front/), then confirm npm run dev or the configured serve command works in the issue workspace.",
  );

  return lines.join("\n");
}

export function previewHandoffTarget(execution?: AgentExecution): PreviewAssistantHandoffTarget {
  if (execution?.status === "live" || execution?.status === "waiting") {
    return "execution-steer";
  }
  return "authoring";
}

export function stashPreviewAssistantHandoff(handoff: PreviewAssistantHandoff): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(handoff));
}

export function consumePreviewAssistantHandoff(
  projectSlug: string,
  issueIdentifier: string,
): PreviewAssistantHandoff | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PreviewAssistantHandoff;
    if (parsed.projectSlug !== projectSlug || parsed.issueIdentifier !== issueIdentifier) {
      return null;
    }

    sessionStorage.removeItem(STORAGE_KEY);
    return parsed;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function isPreviewFailureReason(reason: IssueDevServerReason): boolean {
  return reason === "start_failed" || reason === "restart_failed" || reason === "crashed";
}

export function isPreviewFailureServerStatus(status: IssueDevServer["status"]): boolean {
  return status === "crashed";
}

export function composerSeedFromHandoff(handoff: PreviewAssistantHandoff): string {
  if (handoff.target === "execution-steer") {
    return `/infer ${handoff.message}`;
  }
  return handoff.message;
}
