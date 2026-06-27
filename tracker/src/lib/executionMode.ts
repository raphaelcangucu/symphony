import { Compass, Hammer, Zap, type LucideIcon } from "lucide-react";

import { EXECUTION_MODE_IDS, type AgentKind, type ExecutionMode } from "@/types/issue";

export interface ExecutionModeMeta {
  id: ExecutionMode;
  labelKey: string;
  descKey: string;
  Icon: LucideIcon;
}

export const DEFAULT_EXECUTION_MODE: ExecutionMode = "build";

export const EXECUTION_MODES: ExecutionModeMeta[] = [
  {
    id: "plan",
    labelKey: "issue.agent.executionMode.plan.label",
    descKey: "issue.agent.executionMode.plan.desc",
    Icon: Compass,
  },
  {
    id: "build",
    labelKey: "issue.agent.executionMode.build.label",
    descKey: "issue.agent.executionMode.build.desc",
    Icon: Hammer,
  },
  {
    id: "yolo",
    labelKey: "issue.agent.executionMode.yolo.label",
    descKey: "issue.agent.executionMode.yolo.desc",
    Icon: Zap,
  },
];

export function executionModeMeta(id: ExecutionMode): ExecutionModeMeta {
  return EXECUTION_MODES.find((mode) => mode.id === id) ?? EXECUTION_MODES[1];
}

/**
 * Modes selectable for a given agent. Cursor's CLI has no read-only mode, so
 * `plan` is hidden there (it would silently fall back to build).
 */
export function availableModesFor(agent: AgentKind): ExecutionMode[] {
  if (agent === "cursor") {
    return EXECUTION_MODE_IDS.filter((id) => id !== "plan");
  }
  return [...EXECUTION_MODE_IDS];
}

/** Next mode in the agent's available set, wrapping around. */
export function cycleMode(current: ExecutionMode, available: ExecutionMode[]): ExecutionMode {
  if (available.length === 0) return current;
  const index = available.indexOf(current);
  if (index === -1) return available[0];
  return available[(index + 1) % available.length];
}
