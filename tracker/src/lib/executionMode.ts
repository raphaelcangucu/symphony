import { Compass, Hammer, Zap, type LucideIcon } from "lucide-react";

import { EXECUTION_MODE_IDS, type AgentKind, type ExecutionMode } from "@/types/issue";

export interface ExecutionModeMeta {
  id: ExecutionMode;
  labelKey: string;
  descKey: string;
  Icon: LucideIcon;
}

// Agent runs are non-interactive: there is no operator to approve a tool mid-run,
// so the default is the no-approval, full-access mode. Plan/Build stay selectable.
export const DEFAULT_EXECUTION_MODE: ExecutionMode = "yolo";

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
  return (
    EXECUTION_MODES.find((mode) => mode.id === id) ??
    EXECUTION_MODES.find((mode) => mode.id === DEFAULT_EXECUTION_MODE) ??
    EXECUTION_MODES[0]
  );
}

export function availableModesFor(agent: AgentKind): ExecutionMode[] {
  return [...EXECUTION_MODE_IDS];
}

/** Next mode in the agent's available set, wrapping around. */
export function cycleMode(current: ExecutionMode, available: ExecutionMode[]): ExecutionMode {
  if (available.length === 0) return current;
  const index = available.indexOf(current);
  if (index === -1) return available[0];
  return available[(index + 1) % available.length];
}
