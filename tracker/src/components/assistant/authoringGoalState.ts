import type { GoalPillPhase } from "@/components/shared/GoalPill";
import type { AuthoringGoalStatus } from "@/services/phoenix/assistantChannel";

export interface AuthoringGoalState {
  enabled: boolean;
  objective: string | null;
  native: boolean;
  status: string | null;
  timeUsedSeconds: number | null;
}

export const emptyAuthoringGoal: AuthoringGoalState = {
  enabled: false,
  objective: null,
  native: false,
  status: null,
  timeUsedSeconds: null,
};

export function mergeGoalStatus(prev: AuthoringGoalState, status: AuthoringGoalStatus): AuthoringGoalState {
  return {
    enabled: status.enabled,
    objective: status.objective ?? prev.objective,
    native: status.native,
    status: status.goal?.status ?? (status.native ? prev.status : null),
    timeUsedSeconds: status.goal?.timeUsedSeconds ?? prev.timeUsedSeconds,
  };
}

export function authoringGoalPhase(goal: AuthoringGoalState, running: boolean): GoalPillPhase {
  if (running) return "running";
  switch (goal.status) {
    case "paused":
      return "paused";
    case "completed":
    case "complete":
    case "done":
    case "satisfied":
      return "completed";
    case "blocked":
    case "failed":
    case "cancelled":
    case "canceled":
      return "stalled";
    default:
      // native + active-but-not-running reads as stalled (resumable); no native goal yet = pending.
      return goal.native ? "stalled" : "pending";
  }
}
