import axios from "axios";

import { i18n } from "@/i18n";
import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";

import { LONG_RUNNING_HTTP_TIMEOUT_MS, http, trackerPath, unwrapData } from "./http";

export interface WorkspaceProvisionResult {
  workspacePath: string;
  status: string;
}

interface BackendWorkspaceProvisionDto {
  workspace_path: string;
  status: string;
}

export async function provisionThreadWorkspace(threadId: number): Promise<WorkspaceProvisionResult> {
  if (!Number.isInteger(threadId) || threadId <= 0) {
    throw new Error("threadId must be a positive integer");
  }

  try {
    const response = await http.post(
      trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}/workspace/provision`),
      undefined,
      { timeout: LONG_RUNNING_HTTP_TIMEOUT_MS },
    );

    const dto = unwrapData<BackendWorkspaceProvisionDto>(response);
    return { workspacePath: dto.workspace_path, status: dto.status };
  } catch (cause) {
    throw new Error(extractApiErrorMessage(cause, i18n.t("assistant.panel.workspaceProvision.retryFailed")));
  }
}

/**
 * Idempotently (re)provisions an issue's workspace. Safe to call repeatedly,
 * including from a "Try again" affordance after a failed turn: concurrent
 * retries join the same single-flight the backend already runs for this path.
 */
export async function provisionWorkspace(
  projectSlug: string,
  issueIdentifier: string,
): Promise<WorkspaceProvisionResult> {
  const slug = requireProjectSlug(projectSlug);
  const identifier = requireNonBlank(issueIdentifier, "issueIdentifier");

  try {
    const response = await http.post(
      trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(identifier)}/workspace/provision`),
      undefined,
      { timeout: LONG_RUNNING_HTTP_TIMEOUT_MS },
    );

    const dto = unwrapData<BackendWorkspaceProvisionDto>(response);
    return { workspacePath: dto.workspace_path, status: dto.status };
  } catch (cause) {
    throw new Error(extractApiErrorMessage(cause, i18n.t("assistant.panel.workspaceProvision.retryFailed")));
  }
}

function extractApiErrorMessage(cause: unknown, fallback: string): string {
  if (axios.isAxiosError(cause)) {
    const body = cause.response?.data;
    if (body && typeof body === "object" && "error" in body) {
      const error = (body as { error?: { message?: string } }).error;
      if (error?.message) return error.message;
    }
    if (cause.message) return cause.message;
  }

  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}
