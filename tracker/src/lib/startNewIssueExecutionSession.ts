import type { TFunction } from "i18next";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";

import { projectSessionsPath } from "@/lib/workspaceRoutes";
import { DEFAULT_EXECUTION_MODE } from "@/lib/executionMode";
import { dispatchIssueAgent, type IssueDispatchResult } from "@/services/issueDispatch";
import type { AgentKind, ExecutionMode, Issue } from "@/types/issue";

export interface StartNewIssueExecutionSessionOptions {
  navigate?: NavigateFunction;
  /** When true (default), navigate to the sessions workspace after dispatch. */
  navigateToSessions?: boolean;
  onIssueUpdated?: (issue: Issue) => void;
  t?: TFunction;
  mode?: ExecutionMode;
  agent?: AgentKind | null;
  instructions?: string | null;
}

export async function startNewIssueExecutionSession(
  projectSlug: string,
  issueIdentifier: string,
  options: StartNewIssueExecutionSessionOptions = {},
): Promise<IssueDispatchResult> {
  const result = await dispatchIssueAgent(projectSlug, issueIdentifier, {
    action: "hard_reset",
    mode: options.mode ?? DEFAULT_EXECUTION_MODE,
    agent: options.agent ?? undefined,
    instructions: options.instructions ?? null,
  });
  options.onIssueUpdated?.(result.issue);

  if (options.navigateToSessions !== false && options.navigate) {
    // Dispatch does not return the new thread id yet — land on workspaces; the
    // orchestrator session appears as a real `/workspaces/<threadId>` row.
    options.navigate(projectSessionsPath(projectSlug));
  }

  if (options.t) {
    const message =
      result.message.trim() ||
      options.t("issueSession.started", { identifier: issueIdentifier });
    toast.success(message);
  }

  return result;
}

export function issueSessionStartErrorMessage(cause: unknown, t: TFunction, identifier: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return t("issueSession.startFailed", { identifier });
}
