import type { GoalPillPhase, GoalPillProvider } from "@/components/shared/GoalPill";
import {
  deriveGoalPresentation,
  normalizeGoalLifecycle,
  normalizeGoalProvider,
  type CanonicalGoalLifecycle,
} from "@/components/shared/goalPresentation";
import type { AuthoringGoalStatus } from "@/services/phoenix/assistantChannel";

export interface AuthoringGoalState {
  enabled: boolean;
  objective: string | null;
  native: boolean;
  lifecycle: CanonicalGoalLifecycle | null;
  provider: GoalPillProvider | null;
  source: string | null;
  capabilities: readonly string[];
  tokenBudget: number | null;
  tokensUsed: number | null;
  timeUsedSeconds: number | null;
  processRunning: boolean;
  processStartedAt: string | null;
  processElapsedSeconds: number | null;
  resumable: boolean;
  interrupted: boolean;
  revision: string | null;
  requestOrder: number | null;
  eventOrder: number | null;
  updatedAt: number | string | null;
  error: string | null;
}

export const emptyAuthoringGoal: AuthoringGoalState = {
  enabled: false,
  objective: null,
  native: false,
  lifecycle: null,
  provider: null,
  source: null,
  capabilities: [],
  tokenBudget: null,
  tokensUsed: null,
  timeUsedSeconds: null,
  processRunning: false,
  processStartedAt: null,
  processElapsedSeconds: null,
  resumable: false,
  interrupted: false,
  revision: null,
  requestOrder: null,
  eventOrder: null,
  updatedAt: null,
  error: null,
};

export function mergeGoalStatus(_prev: AuthoringGoalState, status: AuthoringGoalStatus): AuthoringGoalState {
  const goal = status.goal;
  return {
    enabled: status.enabled,
    objective: status.objective ?? goal?.objective ?? null,
    native: status.native,
    lifecycle: normalizeGoalLifecycle(status.status ?? goal?.status),
    provider: normalizeGoalProvider(status.provider, status.source ?? goal?.source),
    source: status.source ?? goal?.source ?? null,
    capabilities: [...new Set(status.capabilities.length > 0 ? status.capabilities : (goal?.capabilities ?? []))],
    tokenBudget: status.tokenBudget ?? goal?.tokenBudget ?? null,
    tokensUsed: status.tokensUsed ?? goal?.tokensUsed ?? null,
    timeUsedSeconds: status.timeUsedSeconds ?? goal?.timeUsedSeconds ?? status.processElapsedSeconds,
    processRunning: status.processRunning,
    processStartedAt: status.processStartedAt,
    processElapsedSeconds: status.processElapsedSeconds,
    resumable: status.resumable,
    interrupted: status.interrupted,
    revision: status.revision ?? goal?.revision ?? null,
    requestOrder: status.requestOrder,
    eventOrder: status.eventOrder,
    updatedAt: status.updatedAt ?? goal?.updatedAt ?? null,
    error: status.error,
  };
}

export function authoringGoalPhase(goal: AuthoringGoalState): GoalPillPhase {
  return deriveGoalPresentation({
    status: goal.lifecycle,
    processRunning: goal.processRunning,
    resumable: goal.resumable,
    interrupted: goal.interrupted,
  }).phase;
}
