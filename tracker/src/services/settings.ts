import { http, trackerPath, unwrapData } from "@/services/http";
import type { AgentKind } from "@/types/issue";

export interface AgentSettings {
  default_agent_kind: AgentKind;
}

export interface OrchestratorSettings {
  require_symphony_label: boolean;
  require_assignee_match: boolean;
}

export interface AllSettings {
  agents: AgentSettings;
  orchestrator: OrchestratorSettings;
}

export interface AgentAvailabilityEntry {
  available: boolean;
  version: string | null;
  command: string;
}

export interface AgentAvailability {
  codex: AgentAvailabilityEntry;
  claude: AgentAvailabilityEntry;
  cursor: AgentAvailabilityEntry;
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

export async function updateOrchestratorSettings(
  input: Partial<OrchestratorSettings>,
): Promise<OrchestratorSettings> {
  const response = await http.put(trackerPath("/settings/orchestrator"), input);
  return unwrapData<OrchestratorSettings>(response);
}

export type TrackerProvider = "github" | "jira" | "linear";

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
  provider: TrackerProvider;
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
