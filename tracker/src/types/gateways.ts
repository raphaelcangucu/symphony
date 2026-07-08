export type GatewayAgentKind = "codex" | "claude" | "cursor" | "opencode";
export type GatewayMode = "explore" | "project" | "issue" | "kb" | "freeform";

export interface TelegramGatewaySettings {
  enabled: boolean;
  botUsername: string | null;
  botTokenConfigured: boolean;
  groupChatId: string | null;
  allowedUserIds: string[];
  dmPolicy: "allowlist";
  dmAllowedUserIds: string[];
  requireMention: boolean;
  pollingEnabled: boolean;
}

export interface GatewaySettings {
  telegram: TelegramGatewaySettings;
}

export interface ProjectTelegramBinding {
  id: number;
  projectSlug: string;
  conversationId: string;
  threadId: string;
  status: "active" | "disabled" | "archived";
  defaultAgentKind: GatewayAgentKind | null;
  defaultMode: GatewayMode;
  activeMode: GatewayMode;
  activeThreadId: number | null;
}

export interface ProjectTelegramGateway {
  globalConfigured: boolean;
  binding: ProjectTelegramBinding | null;
}
