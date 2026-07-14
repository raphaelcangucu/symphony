import { Compass, Hammer, Zap, type LucideIcon } from "lucide-react";

import { EXECUTION_MODE_IDS, type AgentKind, type ExecutionMode } from "@/types/issue";

/** Operator-facing agent mode (sandbox / approvals). Same IDs as ExecutionMode. */
export type AgentMode = ExecutionMode;

export const AGENT_MODE_IDS = EXECUTION_MODE_IDS;

export interface AgentModeMeta {
  id: AgentMode;
  labelKey: string;
  descKey: string;
  Icon: LucideIcon;
  permissionKey: string;
}

/** Default for interactive issue sessions (Plan). Autonomous runs still use yolo. */
export const DEFAULT_INTERACTIVE_MODE: AgentMode = "plan";

/** Default for autonomous / orchestrator runs (no human to approve). */
export const DEFAULT_AUTONOMOUS_MODE: AgentMode = "yolo";

/** @deprecated Prefer DEFAULT_AUTONOMOUS_MODE or DEFAULT_INTERACTIVE_MODE by surface. */
export const DEFAULT_EXECUTION_MODE: AgentMode = DEFAULT_AUTONOMOUS_MODE;

export const AGENT_MODES: AgentModeMeta[] = [
  {
    id: "plan",
    labelKey: "issue.agent.executionMode.plan.label",
    descKey: "issue.agent.executionMode.plan.desc",
    permissionKey: "issue.agent.executionMode.plan.permission",
    Icon: Compass,
  },
  {
    id: "build",
    labelKey: "issue.agent.executionMode.build.label",
    descKey: "issue.agent.executionMode.build.desc",
    permissionKey: "issue.agent.executionMode.build.permission",
    Icon: Hammer,
  },
  {
    id: "yolo",
    labelKey: "issue.agent.executionMode.yolo.label",
    descKey: "issue.agent.executionMode.yolo.desc",
    permissionKey: "issue.agent.executionMode.yolo.permission",
    Icon: Zap,
  },
];

/** @deprecated Use AGENT_MODES */
export const EXECUTION_MODES = AGENT_MODES;

export type ExecutionModeMeta = AgentModeMeta;

export function agentModeMeta(id: AgentMode): AgentModeMeta {
  return AGENT_MODES.find((mode) => mode.id === id) ?? AGENT_MODES[0];
}

/** @deprecated Use agentModeMeta */
export function executionModeMeta(id: ExecutionMode): AgentModeMeta {
  return agentModeMeta(id);
}

export function availableModesFor(_agent: AgentKind): AgentMode[] {
  return [...AGENT_MODE_IDS];
}

export function cycleMode(current: AgentMode, available: AgentMode[]): AgentMode {
  if (available.length === 0) return current;
  const index = available.indexOf(current);
  if (index === -1) return available[0];
  return available[(index + 1) % available.length];
}

export function isAgentMode(value: string | null | undefined): value is AgentMode {
  return typeof value === "string" && (AGENT_MODE_IDS as readonly string[]).includes(value);
}

export function normalizeAgentMode(value: string | null | undefined, fallback: AgentMode = DEFAULT_INTERACTIVE_MODE): AgentMode {
  return isAgentMode(value) ? value : fallback;
}
