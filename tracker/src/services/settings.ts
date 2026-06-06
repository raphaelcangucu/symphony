import { http, trackerPath, unwrapData } from "@/services/http";
import type { AgentKind } from "@/types/issue";

export interface AgentSettings {
  default_agent_kind: AgentKind;
}

export interface AllSettings {
  agents: AgentSettings;
}

export interface AgentAvailabilityEntry {
  available: boolean;
  version: string | null;
  command: string;
}

export interface AgentAvailability {
  codex: AgentAvailabilityEntry;
  claude: AgentAvailabilityEntry;
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
