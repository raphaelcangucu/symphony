import { requireProjectSlug } from "@/lib/serviceValidation";
import type {
  GatewayAgentKind,
  GatewayMode,
  GatewaySettings,
  ProjectTelegramBinding,
  ProjectTelegramGateway,
  TelegramGatewaySettings,
} from "@/types/gateways";

import { http, trackerPath, unwrapData } from "./http";

interface BackendTelegramGatewaySettingsDto {
  enabled?: boolean | null;
  bot_username?: string | null;
  botUsername?: string | null;
  bot_token_configured?: boolean | null;
  botTokenConfigured?: boolean | null;
  group_chat_id?: string | null;
  groupChatId?: string | null;
  allowed_user_ids?: unknown;
  allowedUserIds?: unknown;
  dm_policy?: string | null;
  dmPolicy?: string | null;
  dm_allowed_user_ids?: unknown;
  dmAllowedUserIds?: unknown;
  require_mention?: boolean | null;
  requireMention?: boolean | null;
  polling_enabled?: boolean | null;
  pollingEnabled?: boolean | null;
}

interface BackendGatewaySettingsDto {
  telegram?: BackendTelegramGatewaySettingsDto | null;
}

interface BackendProjectTelegramBindingDto {
  id?: number | null;
  project_slug?: string | null;
  projectSlug?: string | null;
  conversation_id?: string | null;
  conversationId?: string | null;
  thread_id?: string | null;
  threadId?: string | null;
  status?: string | null;
  default_agent_kind?: string | null;
  defaultAgentKind?: string | null;
  default_mode?: string | null;
  defaultMode?: string | null;
  active_mode?: string | null;
  activeMode?: string | null;
  active_thread_id?: number | null;
  activeThreadId?: number | null;
}

interface BackendProjectTelegramGatewayDto {
  global_configured?: boolean | null;
  globalConfigured?: boolean | null;
  binding?: BackendProjectTelegramBindingDto | null;
}

export interface TelegramGatewaySettingsInput {
  enabled?: boolean;
  pollingEnabled?: boolean;
  groupChatId?: string | null;
  allowedUserIds?: string[];
  dmAllowedUserIds?: string[];
  requireMention?: boolean;
}

export interface GatewayPairingCode {
  code: string;
  command: string;
}

export function normalizeGatewaySettings(dto: BackendGatewaySettingsDto): GatewaySettings {
  return {
    telegram: normalizeTelegramSettings(dto.telegram ?? {}),
  };
}

export function normalizeProjectTelegramGateway(dto: BackendProjectTelegramGatewayDto): ProjectTelegramGateway {
  return {
    globalConfigured: dto.globalConfigured ?? dto.global_configured ?? false,
    binding: dto.binding ? normalizeProjectTelegramBinding(dto.binding) : null,
  };
}

export async function getGatewaySettings(): Promise<GatewaySettings> {
  const response = await http.get(trackerPath("/settings/gateways"));
  return normalizeGatewaySettings(unwrapData<BackendGatewaySettingsDto>(response));
}

export async function updateTelegramGatewaySettings(input: TelegramGatewaySettingsInput): Promise<GatewaySettings> {
  const response = await http.put(trackerPath("/settings/gateways/telegram"), input);
  return normalizeGatewaySettings(unwrapData<BackendGatewaySettingsDto>(response));
}

export async function createTelegramGroupPairingCode(): Promise<GatewayPairingCode> {
  const response = await http.post(trackerPath("/settings/gateways/telegram/pairing_code"));
  return unwrapData<GatewayPairingCode>(response);
}

export async function getProjectTelegramGateway(projectSlug: string): Promise<ProjectTelegramGateway> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(slug)}/gateways/telegram`));
  return normalizeProjectTelegramGateway(unwrapData<BackendProjectTelegramGatewayDto>(response));
}

export async function createProjectTelegramPairingCode(projectSlug: string): Promise<GatewayPairingCode> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(slug)}/gateways/telegram/pairing_code`));
  return unwrapData<GatewayPairingCode>(response);
}

export async function resetProjectTelegramSession(projectSlug: string): Promise<ProjectTelegramGateway> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(slug)}/gateways/telegram/reset`));
  return normalizeProjectTelegramGateway(unwrapData<BackendProjectTelegramGatewayDto>(response));
}

export async function unpairProjectTelegram(projectSlug: string): Promise<ProjectTelegramGateway> {
  const slug = requireProjectSlug(projectSlug);
  const response = await http.delete(trackerPath(`/projects/${encodeURIComponent(slug)}/gateways/telegram`));
  return normalizeProjectTelegramGateway(unwrapData<BackendProjectTelegramGatewayDto>(response));
}

function normalizeTelegramSettings(dto: BackendTelegramGatewaySettingsDto): TelegramGatewaySettings {
  return {
    enabled: dto.enabled ?? false,
    botUsername: dto.botUsername ?? dto.bot_username ?? null,
    botTokenConfigured: dto.botTokenConfigured ?? dto.bot_token_configured ?? false,
    groupChatId: dto.groupChatId ?? dto.group_chat_id ?? null,
    allowedUserIds: normalizeStringArray(dto.allowedUserIds ?? dto.allowed_user_ids),
    dmPolicy: "allowlist",
    dmAllowedUserIds: normalizeStringArray(dto.dmAllowedUserIds ?? dto.dm_allowed_user_ids),
    requireMention: dto.requireMention ?? dto.require_mention ?? true,
    pollingEnabled: dto.pollingEnabled ?? dto.polling_enabled ?? false,
  };
}

function normalizeProjectTelegramBinding(dto: BackendProjectTelegramBindingDto): ProjectTelegramBinding {
  return {
    id: dto.id ?? 0,
    projectSlug: dto.projectSlug ?? dto.project_slug ?? "",
    conversationId: dto.conversationId ?? dto.conversation_id ?? "",
    threadId: dto.threadId ?? dto.thread_id ?? "",
    status: normalizeStatus(dto.status),
    defaultAgentKind: normalizeAgentKind(dto.defaultAgentKind ?? dto.default_agent_kind),
    defaultMode: normalizeMode(dto.defaultMode ?? dto.default_mode, "explore"),
    activeMode: normalizeMode(dto.activeMode ?? dto.active_mode, "explore"),
    activeThreadId: dto.activeThreadId ?? dto.active_thread_id ?? null,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

function normalizeAgentKind(value: string | null | undefined): GatewayAgentKind | null {
  return value === "codex" || value === "claude" || value === "cursor" ? value : null;
}

function normalizeMode(value: string | null | undefined, fallback: GatewayMode): GatewayMode {
  return value === "explore" || value === "project" || value === "issue" || value === "kb" || value === "freeform"
    ? value
    : fallback;
}

function normalizeStatus(value: string | null | undefined): ProjectTelegramBinding["status"] {
  return value === "disabled" || value === "archived" ? value : "active";
}
