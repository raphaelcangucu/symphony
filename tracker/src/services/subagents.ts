import { requirePositiveInteger, requireProjectSlug } from "@/lib/serviceValidation";
import { http, trackerPath } from "@/services/http";

export interface SubagentSummary {
  id: string;
  agentKind: string;
  label: string | null;
  nickname: string | null;
  role: string | null;
  toolUseId: string | null;
}

interface BackendSubagentDto {
  id?: unknown;
  agent_kind?: unknown;
  label?: unknown;
  nickname?: unknown;
  role?: unknown;
  tool_use_id?: unknown;
}

export interface ListSubagentsOpts {
  agentKind?: string;
  toolUseId?: string;
  matchPrompt?: string;
}

export async function listSubagents(
  projectSlug: string,
  threadId: number,
  opts: ListSubagentsOpts = {},
): Promise<SubagentSummary[]> {
  const slug = requireProjectSlug(projectSlug);
  const id = requirePositiveInteger(threadId, "threadId");

  const params = new URLSearchParams();
  const agentKind = trimOrNull(opts.agentKind);
  const toolUseId = trimOrNull(opts.toolUseId);
  const matchPrompt = trimOrNull(opts.matchPrompt);
  if (agentKind) params.set("agent_kind", agentKind);
  if (toolUseId) params.set("tool_use_id", toolUseId);
  if (matchPrompt) params.set("match_prompt", matchPrompt);

  const query = params.toString();
  const path = trackerPath(
    `/projects/${encodeURIComponent(slug)}/workspaces/${encodeURIComponent(String(id))}/subagents${
      query ? `?${query}` : ""
    }`,
  );

  const response = await http.get<{ subagents?: unknown }>(path);
  const raw = response.data?.subagents;
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeSubagent).filter((entry): entry is SubagentSummary => entry !== null);
}

export function normalizeSubagent(value: unknown): SubagentSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const dto = value as BackendSubagentDto;
  const id = typeof dto.id === "string" ? dto.id.trim() : "";
  if (!id) return null;

  return {
    id,
    agentKind: typeof dto.agent_kind === "string" && dto.agent_kind.trim() ? dto.agent_kind.trim() : "codex",
    label: stringOrNull(dto.label),
    nickname: stringOrNull(dto.nickname),
    role: stringOrNull(dto.role),
    toolUseId: stringOrNull(dto.tool_use_id),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
