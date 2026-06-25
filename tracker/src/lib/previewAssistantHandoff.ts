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

export interface ProjectAssistantHandoff {
  projectSlug: string;
  message: string;
  createdAt: number;
}

const PROJECT_STORAGE_KEY = "symphony:project-assistant-handoff";

export function buildWarmUpBootstrapPrompt(projectSlug: string): string {
  return [
    `Prepare the dev environment for project "${projectSlug}" before any task starts.`,
    "",
    'Call manage_dev_env with action "warm_up" to run the deterministic warm-up',
    "(ECR login, pull/build images, boot a dry-run on an ephemeral port, confirm a",
    "tenant-aware /health for the default tenant, then tear it down).",
    "",
    "If it fails, read data.failure_class and data.remediation and fix it in this thread,",
    "then call warm_up again. Loop until it succeeds or you are blocked on the user.",
    "",
    "IMPORTANT — when something is MISSING that only the user can provide (credentials,",
    "secrets, tokens), i.e. data.remediation.needs_user_input is true: ASK THE USER for the",
    "exact values (use the questions in data.remediation.ask). Never invent, guess, or",
    "hardcode secrets. After the user answers, apply the values and re-run warm_up.",
    "",
    "Failure handling by class:",
    "- image_pull_auth → ASK the user for AWS credentials (access key id, secret, region/profile),",
    "  then configure the AWS profile or docker/.env and re-run.",
    "- needs_scaffold → scaffold the .symphony/ scripts, propose a commit, then re-run.",
    "- container_name_conflict / port_allocation → inspect docker and resolve, then re-run.",
    "- db_not_seeded → the default-tenant DB is missing and the scrubbed-dump import needs an",
    "  authenticated GitHub CLI: ASK the user to run `gh auth login` (or provide a dump path),",
    "  then run `bash .symphony/ensure-tenant-db.sh illume` and re-run. Never fabricate DB data.",
    "- health_timeout → read the logs; if the default-tenant DB is missing, seed it; ask the",
    "  user only if a decision or secret is required.",
  ].join("\n");
}

export function stashProjectAssistantHandoff(handoff: ProjectAssistantHandoff): void {
  sessionStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(handoff));
}

export function consumeProjectAssistantHandoff(projectSlug: string): ProjectAssistantHandoff | null {
  const raw = sessionStorage.getItem(PROJECT_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ProjectAssistantHandoff;
    if (parsed.projectSlug !== projectSlug) return null;

    sessionStorage.removeItem(PROJECT_STORAGE_KEY);
    return parsed;
  } catch {
    sessionStorage.removeItem(PROJECT_STORAGE_KEY);
    return null;
  }
}
