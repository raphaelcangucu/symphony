import type { TFunction } from "i18next";

import { i18n } from "@/i18n";
import type { AgentExecution, AgentExecutionStatus } from "@/types/agent-execution";

function hasInterruptedSignals(execution: AgentExecution): boolean {
  if (execution.error?.trim()) return true;
  const event = execution.lastEvent?.toLowerCase() ?? "";
  return event.includes("aborted") || event === "turn_aborted";
}

/** Single display status for board cards and execution detail. */
export function resolveDisplayStatus(execution: AgentExecution): AgentExecutionStatus {
  if (execution.status === "aborted" || execution.status === "error") return execution.status;
  if (hasInterruptedSignals(execution)) return "aborted";
  return execution.status;
}

export function reconcileExecutionStatus(execution: AgentExecution): AgentExecution {
  const status = resolveDisplayStatus(execution);
  if (status === execution.status) return execution;
  return { ...execution, status };
}

export function isActiveAgentRun(execution?: AgentExecution): boolean {
  if (!execution) return false;
  const status = resolveDisplayStatus(execution);
  return status === "live" || status === "waiting" || status === "idle";
}

export function canResumeExecution(execution?: AgentExecution): boolean {
  if (!execution) return true;
  return !isActiveAgentRun(execution);
}

export function canSteerExecution(execution?: AgentExecution): boolean {
  if (!execution) return false;
  const status = resolveDisplayStatus(execution);
  return status === "live" || status === "waiting";
}

export function executionNeedsAttention(execution?: AgentExecution): boolean {
  if (!execution) return false;
  const status = resolveDisplayStatus(execution);
  return status === "aborted" || status === "error";
}

/**
 * High-level control state for the unified Agent Control surface. `live` is
 * renamed to `running` so the UI reads naturally ("Running"); every other
 * display status is preserved. `no-run` means there is no execution to act on
 * yet (the agent has never been dispatched, or finished and dropped out of the
 * orchestrator snapshot).
 */
export type AgentControlState =
  | "no-run"
  | "running"
  | "idle"
  | "waiting"
  | "retrying"
  | "error"
  | "aborted";

/** Lifecycle action the primary control button performs in a given state. */
export type AgentPrimaryAction = "start" | "resume" | "pause";

/** What pressing Enter in the composer does in a given state. */
export type AgentEnterIntent = "steer" | "queue" | "resume" | "start";

export interface AgentControlModel {
  /** Normalized control state (`live` -> `running`). */
  state: AgentControlState;
  /** Whether an execution exists to act on. */
  hasRun: boolean;
  /** Run is in progress (live/waiting/idle). */
  isActive: boolean;
  /** Live turn can accept `/infer` steering right now (live/waiting). */
  canSteer: boolean;
  /** Run can be resumed/restarted (not currently active). */
  canResume: boolean;
  /** Run can be paused (currently active). */
  canPause: boolean;
  /** Lifecycle action for the primary control button. */
  primaryAction: AgentPrimaryAction;
  /** Human label for the primary control button. */
  primaryLabel: string;
  /** What Enter does in the composer for this state. */
  enterIntent: AgentEnterIntent;
}

/** Derives the full Agent Control model from an execution snapshot. */
export function deriveAgentControl(
  execution?: AgentExecution,
  t: TFunction = i18n.t.bind(i18n) as TFunction,
): AgentControlModel {
  if (!execution) {
    return {
      state: "no-run",
      hasRun: false,
      isActive: false,
      canSteer: false,
      canResume: true,
      canPause: false,
      primaryAction: "start",
      primaryLabel: t("issue.agent.primaryStart"),
      enterIntent: "start",
    };
  }

  const status = resolveDisplayStatus(execution);
  const isActive = status === "live" || status === "waiting" || status === "idle";
  const canSteer = status === "live" || status === "waiting";
  const state: AgentControlState = status === "live" ? "running" : status;

  return {
    state,
    hasRun: true,
    isActive,
    canSteer,
    canResume: !isActive,
    canPause: isActive,
    primaryAction: isActive ? "pause" : "resume",
    primaryLabel: isActive ? t("issue.agent.primaryPause") : t("issue.agent.primaryResume"),
    enterIntent: canSteer ? "steer" : isActive ? "queue" : "resume",
  };
}

/** Short hint shown next to the composer describing the Enter action. */
export function agentEnterHintLabel(
  intent: AgentEnterIntent,
  t: TFunction = i18n.t.bind(i18n) as TFunction,
): string {
  switch (intent) {
    case "steer":
      return t("issue.agent.enterSteer");
    case "queue":
      return t("issue.agent.enterQueue");
    case "resume":
      return t("issue.agent.enterResume");
    case "start":
      return t("issue.agent.enterStart");
  }
}
