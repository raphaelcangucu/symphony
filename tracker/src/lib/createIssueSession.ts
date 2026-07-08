import type { TFunction } from "i18next";
import { toast } from "sonner";

import { createIssueSessionThread } from "@/services/assistantThreads";
import type { AgentKind, ExecutionMode, Issue } from "@/types/issue";
import type { AssistantThread } from "@/types/assistant-thread";

export interface CreateIssueSessionInput {
  mode?: ExecutionMode;
  agent?: AgentKind | null;
  title?: string | null;
  instructions?: string | null;
}

export async function createIssueSession(
  projectSlug: string,
  issueIdentifier: string,
  input: CreateIssueSessionInput = {},
  t?: TFunction,
): Promise<AssistantThread> {
  const thread = await createIssueSessionThread(projectSlug, issueIdentifier, {
    title: input.title?.trim() || undefined,
    agentKind: input.agent === "opencode" ? undefined : (input.agent ?? undefined),
    executionMode: input.mode ?? "build",
  });

  if (t) {
    toast.success(t("issueSession.started", { identifier: issueIdentifier }));
  }

  return thread;
}

export function issueSessionStartErrorMessage(cause: unknown, t: TFunction, identifier: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return t("issueSession.startFailed", { identifier });
}

export type { Issue };
