/**
 * @deprecated Prefer `@/lib/agentModes`. Kept for backward-compatible imports.
 */
export {
  AGENT_MODES as EXECUTION_MODES,
  DEFAULT_AUTONOMOUS_MODE as DEFAULT_EXECUTION_MODE,
  DEFAULT_INTERACTIVE_MODE,
  DEFAULT_AUTONOMOUS_MODE,
  agentModeMeta as executionModeMeta,
  availableModesFor,
  cycleMode,
  type AgentModeMeta as ExecutionModeMeta,
  type AgentMode,
} from "@/lib/agentModes";
