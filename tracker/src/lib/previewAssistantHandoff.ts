import type { TFunction } from "i18next";

import { i18n } from "@/i18n";
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
  t: TFunction = i18n.t.bind(i18n),
): string {
  const availabilityStatus = snapshot.available
    ? t("issue.preview.available")
    : t("issue.preview.unavailable");

  const lines = [t("issue.preview.failurePrompt.intro"), "", t("issue.preview.failurePrompt.availability", { status: availabilityStatus })];

  if (snapshot.reason) {
    lines.push(t("issue.preview.failurePrompt.availabilityReason", { reason: snapshot.reason }));
  }

  if (server) {
    lines.push("");
    lines.push(t("issue.preview.failurePrompt.failedServer", { slug: server.slug }));
    lines.push(t("issue.preview.failurePrompt.status", { status: server.status }));
    if (server.working_dir) {
      lines.push(t("issue.preview.failurePrompt.workingDirectory", { dir: server.working_dir }));
    }
    if (server.port != null) lines.push(t("issue.preview.failurePrompt.port", { port: server.port }));
    if (server.session_name) {
      lines.push(t("issue.preview.failurePrompt.tmuxSession", { session: server.session_name }));
      lines.push(t("issue.preview.failurePrompt.inspectLogs", { session: server.session_name }));
    }
  }

  lines.push("");
  lines.push(t("issue.preview.failurePrompt.footer"));

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
