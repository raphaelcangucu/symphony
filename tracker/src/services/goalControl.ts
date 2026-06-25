import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { AgentExecutionGoal } from "@/types/agent-execution";

import { normalizeGoal } from "./agentExecutions";
import { http, trackerPath, unwrapData } from "./http";

/**
 * Operator controls that map directly onto the native Codex `thread/goal/*` API.
 * The goal persisted in the Codex thread is the source of truth; these calls do
 * not maintain a parallel Symphony goal state.
 */
export type GoalControlAction = "get" | "pause" | "resume" | "clear" | "set_objective" | "set_budget";

export interface GoalControlInput {
  action: GoalControlAction;
  objective?: string | null;
  /** Positive integer to cap the budget, or `null` to make the goal unlimited. */
  tokenBudget?: number | null;
}

export interface GoalControlResult {
  action: GoalControlAction;
  cleared: boolean;
  goal: AgentExecutionGoal | null;
}

interface BackendGoalControlDto {
  action?: string;
  cleared?: boolean;
  goal?: Record<string, unknown> | null;
}

export async function controlIssueGoal(
  projectSlug: string,
  identifier: string,
  input: GoalControlInput,
): Promise<GoalControlResult> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");

  const payload: Record<string, unknown> = { action: input.action };
  if (input.action === "set_objective") {
    payload.objective = (input.objective ?? "").trim();
  }
  if (input.action === "set_budget") {
    payload.token_budget = input.tokenBudget ?? null;
  }

  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/goal`),
    payload,
  );

  const dto = unwrapData<BackendGoalControlDto>(response);

  return {
    action: input.action,
    cleared: dto.cleared ?? false,
    goal: normalizeGoal(dto.goal),
  };
}
