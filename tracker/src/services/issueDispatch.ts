import type { AgentKind, Issue } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendIssueDto, normalizeIssue } from "./mappers";

export type IssueDispatchAction = "resume" | "restart";

export interface IssueDispatchInput {
  action: IssueDispatchAction;
  agent?: AgentKind | null;
  goal?: string | null;
  instructions?: string | null;
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
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");

  const payload: Record<string, unknown> = { action: input.action };
  if (input.agent) payload.agent = input.agent;
  if (input.goal?.trim()) payload.goal = input.goal.trim();
  if (input.instructions?.trim()) payload.instructions = input.instructions.trim();

  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/dispatch`),
    payload,
  );

  const dto = unwrapData<BackendIssueDispatchDto>(response);
  if (!dto.issue) throw new Error("dispatch response missing issue");

  return {
    action: dto.action === "restart" ? "restart" : "resume",
    message: dto.message ?? "",
    issue: normalizeIssue(dto.issue),
  };
}
