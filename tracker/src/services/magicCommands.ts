import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { AgentKind, ExecutionMode, Issue } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";
import { type IssueDispatchAction } from "./issueDispatch";
import { type BackendIssueDto, normalizeIssue } from "./mappers";

export interface RunPromptTemplateOverrides {
  agent?: AgentKind | null;
  model?: string | null;
  effort?: string | null;
  mode?: ExecutionMode | null;
}

export interface RunPromptTemplateResult {
  ok: boolean;
  action: IssueDispatchAction;
  message: string;
  issue: Issue;
}

interface BackendRunPromptTemplateDto {
  ok?: boolean;
  action?: string;
  message?: string;
  issue?: BackendIssueDto;
}

export async function runPromptTemplate(
  projectSlug: string,
  identifier: string,
  slug: string,
  overrides?: RunPromptTemplateOverrides,
): Promise<RunPromptTemplateResult> {
  const validatedProjectSlug = requireProjectSlug(projectSlug);
  const validatedIdentifier = requireNonBlank(identifier, "identifier");
  const validatedSlug = requireNonBlank(slug, "slug");

  const payload: Record<string, unknown> = { slug: validatedSlug };

  const agent = trimmedOrNull(overrides?.agent);
  if (agent) payload.agent = agent;

  const model = trimmedOrNull(overrides?.model);
  if (model) payload.model = model;

  const effort = trimmedOrNull(overrides?.effort);
  if (effort) payload.effort = effort;

  const mode = trimmedOrNull(overrides?.mode);
  if (mode) payload.mode = mode;

  const response = await http.post(
    trackerPath(
      `/projects/${encodeURIComponent(validatedProjectSlug)}/issues/${encodeURIComponent(validatedIdentifier)}/run-prompt-template`,
    ),
    payload,
  );

  const dto = unwrapData<BackendRunPromptTemplateDto>(response);
  if (!dto.issue) {
    throw new Error("runPromptTemplate response missing issue");
  }

  return {
    ok: dto.ok !== false,
    action: normalizeDispatchAction(dto.action),
    message: dto.message ?? "",
    issue: normalizeIssue(dto.issue),
  };
}

function normalizeDispatchAction(action: string | undefined): IssueDispatchAction {
  if (action === "restart" || action === "hard_reset" || action === "stop" || action === "continue_work") {
    return action;
  }
  return "resume";
}

function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
