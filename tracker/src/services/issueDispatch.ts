import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import { i18n } from "@/i18n";
import type { AgentKind, Issue } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendIssueDto, normalizeIssue } from "./mappers";

export type IssueDispatchAction = "resume" | "restart" | "hard_reset" | "stop" | "continue_work";

export interface IssueDispatchInput {
  action: IssueDispatchAction;
  agent?: AgentKind | null;
  goal?: string | null;
  instructions?: string | null;
  targetStatus?: string | null;
  model?: string | null;
  effort?: string | null;
}

export interface IssueDispatchResult {
  action: IssueDispatchAction;
  message: string;
  issue: Issue;
}

interface BackendIssueDispatchDto {
  action?: string;
  message?: string;
  issue?: BackendIssueDto;
}

export async function dispatchIssueAgent(
  projectSlug: string,
  identifier: string,
  input: IssueDispatchInput,
): Promise<IssueDispatchResult> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");

  const payload: Record<string, unknown> = { action: input.action };
  if (input.agent) payload.agent = input.agent;
  if (input.goal?.trim()) payload.goal = input.goal.trim();
  if (input.instructions?.trim()) payload.instructions = input.instructions.trim();
  if (input.targetStatus?.trim()) payload.target_status = input.targetStatus.trim();
  if (input.model?.trim()) payload.model = input.model.trim();
  if (input.effort?.trim()) payload.effort = input.effort.trim();

  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/dispatch`),
    payload,
  );

  const dto = unwrapData<BackendIssueDispatchDto>(response);
  if (!dto.issue) throw new Error(i18n.t("project.services.validation.dispatchResponseMissingIssue"));

  return {
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
