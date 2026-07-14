import { http, trackerPath, unwrapData } from "@/services/http";
import type { AgentKind } from "@/types/issue";
import type { GatewaySettings } from "@/types/gateways";

export type LocalePreference = "auto" | "en" | "pt-BR";

export interface AgentSettings {
  default_agent_kind: AgentKind;
}

export interface OrchestratorSettings {
  require_symphony_label: boolean;
  require_assignee_match: boolean;
  agent_token_budget_enabled: boolean;
  agent_token_budget: number;
}

export interface LabSettings {
  bundle_child_orchestration: boolean;
}

export interface UiSettings {
  locale: LocalePreference;
}

export type AgentModelSettings = Partial<Record<AgentKind, string | null>>;
export type AgentEffortSettings = Partial<Record<AgentKind, string | null>>;

export interface AllSettings {
  agents: AgentSettings;
  agent_models?: AgentModelSettings;
  agent_efforts?: AgentEffortSettings;
  gateways?: GatewaySettings;
  lab: LabSettings;
  orchestrator: OrchestratorSettings;
  ui: UiSettings;
}

export type AgentToolSourceValue = "path" | "none";

export interface AgentToolStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
  command: string;
}

export interface AgentToolSource {
  value: AgentToolSourceValue;
  managed: boolean;
  detail: string | null;
}

export interface AgentToolInstall {
  available: boolean;
  command: string | null;
}

export interface AgentToolModel {
  options: string[];
  selected: string | null;
}

export interface AgentTool {
  id: string;
  kind: AgentKind;
  status: AgentToolStatus;
  source: AgentToolSource;
  install: AgentToolInstall;
  model: AgentToolModel;
}

export interface AgentAvailabilityEntry {
  available: boolean;
  version: string | null;
  command: string;
  authenticated?: boolean | null;
  detail?: string | null;
}

export interface AgentAvailability {
  codex: AgentAvailabilityEntry;
  claude: AgentAvailabilityEntry;
  cursor: AgentAvailabilityEntry;
  opencode: AgentAvailabilityEntry;
}

export async function fetchSettings(): Promise<AllSettings> {
  const response = await http.get(trackerPath("/settings"));
  return unwrapData<AllSettings>(response);
}

export async function updateAgentSettings(input: Partial<AgentSettings>): Promise<AgentSettings> {
  const response = await http.put(trackerPath("/settings/agents"), input);
  return unwrapData<AgentSettings>(response);
}

export async function fetchAgentAvailability(): Promise<AgentAvailability> {
  const response = await http.get(trackerPath("/settings/agents/availability"));
  return unwrapData<AgentAvailability>(response);
}

export async function fetchAgentTools(): Promise<AgentTool[]> {
  const response = await http.get(trackerPath("/settings/agents/tools"));
  return unwrapData<{ tools: AgentTool[] }>(response).tools;
}

export async function updateAgentModel(
  agent: AgentKind,
  model: string | null,
): Promise<AgentModelSettings> {
  const response = await http.put(trackerPath("/settings/agent_models"), { [agent]: model });
  return unwrapData<AgentModelSettings>(response);
}

export async function updateAgentEffort(
  agent: AgentKind,
  effort: string | null,
): Promise<AgentEffortSettings> {
  const response = await http.put(trackerPath("/settings/agent_efforts"), { [agent]: effort });
  return unwrapData<AgentEffortSettings>(response);
}

export async function updateOrchestratorSettings(
  input: Partial<OrchestratorSettings>,
): Promise<OrchestratorSettings> {
  const response = await http.put(trackerPath("/settings/orchestrator"), input);
  return unwrapData<OrchestratorSettings>(response);
}

export async function updateLabSettings(input: Partial<LabSettings>): Promise<LabSettings> {
  const response = await http.put(trackerPath("/settings/lab"), input);
  return unwrapData<LabSettings>(response);
}

export async function updateUiSettings(input: Partial<UiSettings>): Promise<UiSettings> {
  const response = await http.put(trackerPath("/settings/ui"), input);
  return unwrapData<UiSettings>(response);
}

export type TrackerProvider = "github" | "jira" | "linear";
export type CredentialProviderKey = TrackerProvider | "telegram";

export interface ProviderIdentity {
  provider: TrackerProvider;
  match_value: string;
  login: string | null;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export interface IdentityStatus {
  provider: TrackerProvider;
  configured: boolean;
  connected: boolean;
  identity: ProviderIdentity | null;
  error: string | null;
}

export async function fetchIdentities(): Promise<IdentityStatus[]> {
  const response = await http.get(trackerPath("/settings/identities"));
  return unwrapData<IdentityStatus[]>(response);
}

export type CredentialSource = "db" | "env" | "none";

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  configured: boolean;
  source: CredentialSource;
  hint?: string | null;
  value?: string | null;
}

export interface CredentialProvider {
  provider: CredentialProviderKey;
  label: string;
  fields: CredentialField[];
}

export async function fetchCredentials(): Promise<CredentialProvider[]> {
  const response = await http.get(trackerPath("/settings/credentials"));
  return unwrapData<{ providers: CredentialProvider[] }>(response).providers;
}

export async function updateCredential(
  provider: string,
  key: string,
  value: string,
): Promise<CredentialProvider> {
  const response = await http.put(trackerPath("/settings/credentials"), { provider, key, value });
  return unwrapData<CredentialProvider>(response);
}

export async function clearCredential(provider: string, key: string): Promise<CredentialProvider> {
  const response = await http.delete(trackerPath(`/settings/credentials/${provider}/${key}`));
  return unwrapData<CredentialProvider>(response);
}
