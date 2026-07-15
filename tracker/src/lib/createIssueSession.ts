import axios from "axios";
import type { TFunction } from "i18next";
import { toast } from "sonner";

import { createIssueSessionThread } from "@/services/assistantThreads";
import { provisionThreadWorkspace } from "@/services/workspaceProvision";
import type { AgentKind, ExecutionMode, Issue } from "@/types/issue";
import type { AssistantThread } from "@/types/assistant-thread";

export interface CreateIssueSessionInput {
  mode?: ExecutionMode;
  agent?: AgentKind | null;
  title?: string | null;
  instructions?: string | null;
  /** When true the session gets its own clean sibling working tree. */
  isolatedWorkspace?: boolean;
  /** When true the session reuses the parent issue's canonical working tree. */
  useParentWorkspace?: boolean;
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
    isolatedWorkspace: input.isolatedWorkspace === true,
    useParentWorkspace: input.useParentWorkspace === true,
  });

  if (input.isolatedWorkspace === true) {
    void provisionThreadWorkspace(thread.id).catch(() => {
      // Provisioning also runs on the first assistant turn; ignore background failures here.
    });
  }

  if (t) {
    toast.success(t("issueSession.started", { identifier: issueIdentifier }));
  }

  return thread;
}

export function issueSessionStartErrorMessage(cause: unknown, t: TFunction, identifier: string): string {
  if (axios.isAxiosError(cause)) {
    const body = cause.response?.data;
    if (body && typeof body === "object" && "error" in body) {
      const message = (body as { error?: { message?: string } }).error?.message?.trim();
      if (message) return message;
    }
  }

  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return t("issueSession.startFailed", { identifier });
}

export type { Issue };
