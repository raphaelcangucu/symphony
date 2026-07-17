export type SubagentRefResolve = "id" | "toolUseId" | "matchPrompt";

export interface SubagentRef {
  resolve: SubagentRefResolve;
  /** Exact child id (Codex agent_id). */
  id?: string;
  /** Parent-side tool_use id (Claude TaskCreate). */
  toolUseId?: string;
  /** Prompt/description prefix for backend matching (Cursor Task). */
  matchPrompt?: string;
  nickname?: string;
  subagentType?: string;
  /** Short human preview of the delegated task. */
  taskPreview?: string;
}

const AGENT_ID_PATTERN = /^[0-9a-f-]{8,}$/i;
const TASK_PREVIEW_MAX = 140;

export function getSubagentRef(input: {
  toolName: string | null | undefined;
  args: unknown;
  output: unknown;
  toolCallId?: string | null;
}): SubagentRef | null {
  const toolName = normalizeToolName(input.toolName);
  if (!toolName) return null;

  const args = asRecord(input.args);

  if (toolName === "spawn_agent") {
    return resolveSpawnAgent(args, input.output);
  }
  if (toolName === "taskcreate") {
    return resolveTaskCreate(args, input.toolCallId);
  }
  if (toolName === "task") {
    return resolveCursorTask(args);
  }

  return null;
}

function resolveSpawnAgent(
  args: Record<string, unknown> | null,
  output: unknown,
): SubagentRef | null {
  const parsed = parseOutput(output);
  if (!parsed) return null;

  const id = stringOrNull(parsed.agent_id);
  if (!id || !AGENT_ID_PATTERN.test(id)) return null;

  const nickname = stringOrNull(parsed.nickname) ?? undefined;
  const subagentType = stringOrNull(args?.agent_type) ?? undefined;
  const taskPreview =
    truncate(
      firstLine(
        stringOrNull(args?.message) ?? stringOrNull(args?.task) ?? stringOrNull(args?.prompt),
      ),
      TASK_PREVIEW_MAX,
    ) ?? undefined;

  return {
    resolve: "id",
    id,
    ...(nickname ? { nickname } : {}),
    ...(subagentType ? { subagentType } : {}),
    ...(taskPreview ? { taskPreview } : {}),
  };
}

function resolveTaskCreate(
  args: Record<string, unknown> | null,
  toolCallId: string | null | undefined,
): SubagentRef | null {
  const id = typeof toolCallId === "string" ? toolCallId.trim() : "";
  if (!id || !id.startsWith("toolu")) return null;

  const taskPreview =
    truncate(
      firstLine(stringOrNull(args?.subject) ?? stringOrNull(args?.description)),
      TASK_PREVIEW_MAX,
    ) ?? undefined;
  const subagentType = stringOrNull(args?.subagent_type) ?? undefined;

  return {
    resolve: "toolUseId",
    toolUseId: id,
    ...(subagentType ? { subagentType } : {}),
    ...(taskPreview ? { taskPreview } : {}),
  };
}

function resolveCursorTask(args: Record<string, unknown> | null): SubagentRef | null {
  const matchPrompt = stringOrNull(args?.prompt) ?? stringOrNull(args?.description);
  if (!matchPrompt) return null;

  const taskPreview =
    truncate(
      firstLine(stringOrNull(args?.description) ?? stringOrNull(args?.prompt)),
      TASK_PREVIEW_MAX,
    ) ?? undefined;
  const subagentType =
    stringOrNull(args?.subagentType) ?? stringOrNull(args?.subagent_type) ?? undefined;

  return {
    resolve: "matchPrompt",
    matchPrompt,
    ...(subagentType ? { subagentType } : {}),
    ...(taskPreview ? { taskPreview } : {}),
  };
}

function normalizeToolName(toolName: string | null | undefined): string | null {
  if (typeof toolName !== "string") return null;
  const normalized = toolName.trim().toLowerCase();
  return normalized || null;
}

function parseOutput(output: unknown): Record<string, unknown> | null {
  if (output == null) return null;

  if (typeof output === "string") {
    const trimmed = output.trim();
    if (!trimmed) return null;
    try {
      return asRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  return asRecord(output);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstLine(value: string | null): string | null {
  if (!value) return null;
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  if (value.length <= max) return value;
  return value.slice(0, max);
}
