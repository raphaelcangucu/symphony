import type {
  ComposerPermissionLevel,
} from "@/types/assistant-thread";
import type {
  AgentKind,
  ExecutionMode,
} from "@/types/issue";

export interface ComposerPermissionOption {
  id: ComposerPermissionLevel;
  available: boolean;
  unavailableReason?: string;
}

export interface ComposerCapabilities {
  queue: boolean;
  steer: boolean;
  stop: boolean;
  nativeGoal: boolean;
  modelSelection: boolean;
  reasoningEffort: boolean;
  permissions: readonly ComposerPermissionOption[];
  defaultPermission: ComposerPermissionLevel;
}

export interface ComposerBackendCapabilityOverride {
  steer?: boolean;
  availablePermissions?: readonly ComposerPermissionLevel[];
}

const PERMISSION_LEVELS: readonly ComposerPermissionLevel[] = [
  "ask_for_approval",
  "approve_for_me",
  "full_access",
];

export function composerCapabilitiesFor(
  agent: AgentKind,
): ComposerCapabilities {
  return {
    queue: true,
    steer: agent === "codex",
    stop: true,
    nativeGoal: agent === "codex" || agent === "claude",
    modelSelection: true,
    reasoningEffort: agent === "codex" || agent === "claude",
    permissions: PERMISSION_LEVELS.map((id) => ({
      id,
      available: true,
    })),
    defaultPermission: "full_access",
  };
}

export function withBackendCapabilities(
  capabilities: ComposerCapabilities,
  override: ComposerBackendCapabilityOverride,
): ComposerCapabilities {
  const availablePermissions = override.availablePermissions
    ? new Set(override.availablePermissions)
    : null;

  return {
    ...capabilities,
    steer: override.steer ?? capabilities.steer,
    permissions: capabilities.permissions.map((option) => {
      const available =
        availablePermissions?.has(option.id) ?? option.available;
      return available
        ? { id: option.id, available: true }
        : {
            id: option.id,
            available: false,
            unavailableReason: "Unavailable for this agent",
          };
    }),
  };
}

export function permissionLevelForMode(
  mode: ExecutionMode,
): ComposerPermissionLevel {
  if (mode === "plan") return "ask_for_approval";
  if (mode === "build") return "approve_for_me";
  return "full_access";
}

export function executionModeForPermission(
  level: ComposerPermissionLevel,
): ExecutionMode {
  if (level === "ask_for_approval") return "plan";
  if (level === "approve_for_me") return "build";
  return "yolo";
}
