import type { GoalPillPhase, GoalPillProvider } from "@/components/shared/GoalPill";

export type CanonicalGoalLifecycle =
  | "starting"
  | "running"
  | "paused"
  | "completed"
  | "blocked"
  | "failed"
  | "budgetLimited"
  | "usageLimited";

export interface GoalPresentationInput {
  status: string | null | undefined;
  processRunning: boolean;
  resumable: boolean;
  interrupted?: boolean;
}

export interface GoalPresentation {
  lifecycle: CanonicalGoalLifecycle | null;
  phase: GoalPillPhase;
}

export function deriveGoalPresentation(input: GoalPresentationInput): GoalPresentation {
  const lifecycle = normalizeGoalLifecycle(input.status);

  if (input.processRunning) {
    if (lifecycle === "paused" || isTerminalGoalLifecycle(lifecycle)) {
      return { lifecycle, phase: lifecycle };
    }
    return { lifecycle, phase: lifecycle === "starting" ? "starting" : "running" };
  }

  if (lifecycle === "paused" || isTerminalGoalLifecycle(lifecycle)) {
    return { lifecycle, phase: lifecycle };
  }
  if (lifecycle === "starting") return { lifecycle, phase: "starting" };
  if (input.resumable) return { lifecycle, phase: "resumable" };
  if (input.interrupted) return { lifecycle, phase: "stalled" };
  return { lifecycle, phase: "active" };
}

export function normalizeGoalProvider(
  provider: string | null | undefined,
  source: string | null | undefined,
): GoalPillProvider | null {
  if (provider === "codex" || provider === "claude") return provider;
  if (source === "native") return "codex";
  if (source === "claude") return "claude";
  return provider || source ? "unsupported" : null;
}

export function normalizeGoalLifecycle(status: string | null | undefined): CanonicalGoalLifecycle | null {
  switch (status) {
    case "pending":
    case "queued":
    case "starting":
      return "starting";
    case "active":
    case "in_progress":
    case "running":
      return "running";
    case "paused":
    case "interrupted":
      return "paused";
    case "complete":
    case "done":
    case "satisfied":
    case "achieved":
    case "succeeded":
    case "completed":
      return "completed";
    case "waiting":
    case "blocked":
      return "blocked";
    case "cancelled":
    case "canceled":
    case "error":
    case "failed":
      return "failed";
    case "budget_limited":
    case "budget_exceeded":
    case "budgetLimited":
      return "budgetLimited";
    case "usage_limited":
    case "usage_limit":
    case "rate_limited":
    case "usageLimited":
      return "usageLimited";
    default:
      return null;
  }
}

function isTerminalGoalLifecycle(
  lifecycle: CanonicalGoalLifecycle | null,
): lifecycle is "completed" | "blocked" | "failed" | "budgetLimited" | "usageLimited" {
  return (
    lifecycle === "completed" ||
    lifecycle === "blocked" ||
    lifecycle === "failed" ||
    lifecycle === "budgetLimited" ||
    lifecycle === "usageLimited"
  );
}
