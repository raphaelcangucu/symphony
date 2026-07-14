import axios from "axios";

import { i18n } from "@/i18n";
import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";

import { http, trackerPath, unwrapData } from "./http";

export interface WorkspaceProvisionResult {
  workspacePath: string;
  status: string;
}

interface BackendWorkspaceProvisionDto {
  workspace_path: string;
  status: string;
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
