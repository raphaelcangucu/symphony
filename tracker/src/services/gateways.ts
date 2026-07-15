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
  botUsername?: string | null;
  botTokenConfigured?: boolean | null;
  groupChatId?: string | null;
  allowedUserIds?: unknown;
  dmPolicy?: string | null;
  dmAllowedUserIds?: unknown;
  requireMention?: boolean | null;
  pollingEnabled?: boolean | null;
}

interface BackendGatewaySettingsDto {
  telegram?: BackendTelegramGatewaySettingsDto | null;
}

interface BackendProjectTelegramBindingDto {
  id?: number | null;
  projectSlug?: string | null;
  conversationId?: string | null;
  threadId?: string | null;
  status?: string | null;
  defaultAgentKind?: string | null;
  defaultMode?: string | null;
  activeMode?: string | null;
  activeThreadId?: number | null;
}

interface BackendProjectTelegramGatewayDto {
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
    globalConfigured: dto.globalConfigured ?? false,
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
    botUsername: dto.botUsername ?? null,
    botTokenConfigured: dto.botTokenConfigured ?? false,
    groupChatId: dto.groupChatId ?? null,
    allowedUserIds: normalizeStringArray(dto.allowedUserIds),
    dmPolicy: "allowlist",
    dmAllowedUserIds: normalizeStringArray(dto.dmAllowedUserIds),
    requireMention: dto.requireMention ?? true,
    pollingEnabled: dto.pollingEnabled ?? false,
  };
}

function normalizeProjectTelegramBinding(dto: BackendProjectTelegramBindingDto): ProjectTelegramBinding {
  return {
    id: dto.id ?? 0,
    projectSlug: dto.projectSlug ?? "",
    conversationId: dto.conversationId ?? "",
    threadId: dto.threadId ?? "",
    status: normalizeStatus(dto.status),
    defaultAgentKind: normalizeAgentKind(dto.defaultAgentKind),
    defaultMode: normalizeMode(dto.defaultMode, "explore"),
    activeMode: normalizeMode(dto.activeMode, "explore"),
    activeThreadId: dto.activeThreadId ?? null,
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
