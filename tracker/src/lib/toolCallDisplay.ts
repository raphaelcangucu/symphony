const CURSOR_TOOL_LABELS: Record<string, string> = {
  glob: "Glob",
  grep: "Grep",
  read: "Read",
  write: "Write",
  edit: "Edit",
  shell: "Bash",
  semsearch: "SemanticSearch",
  ls: "List",
  delete: "Delete",
};

export type CursorToolKind = "task" | "create_plan" | "other";

export interface CursorToolPresentation {
  toolType: string;
  description: string | null;
  detailLanguage: "json" | "markdown";
  detailMarkdown: string | null;
  kbPath: string | null;
  kind: CursorToolKind;
}

export function resolveToolDisplayName(name: string, ...payloads: Array<string | null | undefined>): string {
  const normalized = name.trim().toLowerCase();
  if (normalized && normalized !== "unknown") {
    return CURSOR_TOOL_LABELS[normalized] ?? humanizeToolName(name);
  }

  for (const payload of payloads) {
    const inferred = inferToolNameFromPayload(payload);
    if (inferred) return inferred;
  }

  return "Unknown";
}

export function formatToolOutput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const nested = parsed.error;
    if (typeof nested === "object" && nested !== null) {
      const record = nested as Record<string, unknown>;
      if (typeof record.error === "string") return record.error;
      if (typeof record.message === "string") return record.message;
    }
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // keep raw text
  }

  return value;
}

export function enrichCursorToolPresentation(name: string, args: unknown): CursorToolPresentation {
  const record = asRecord(args);
  if (isTaskName(name)) {
    const description = truncateMeta(stringField(record, "description"));
    const typeLabel = resolveSubagentTypeLabel(record?.subagentType ?? record?.subagent_type);
    return {
      toolType: `Task · ${typeLabel}`,
      description,
      detailLanguage: "json",
      detailMarkdown: null,
      kbPath: null,
      kind: "task",
    };
  }
  if (isPlanName(name)) {
    const planName = stringField(record, "name");
    const overview = truncateMeta(stringField(record, "overview"));
    const planMd = stringField(record, "plan");
    return {
      toolType: planName ? `Plan · ${planName}` : "Plan",
      description: overview,
      detailLanguage: planMd ? "markdown" : "json",
      detailMarkdown: planMd,
      kbPath: resolveCreatePlanKbPath(record),
      kind: "create_plan",
    };
  }
  return {
    toolType: resolveToolDisplayName(name),
    description: null,
    detailLanguage: "json",
    detailMarkdown: null,
    kbPath: null,
    kind: "other",
  };
}

export function resolveSubagentTypeLabel(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    if (value === "unspecified") return "Subagent";
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ("unspecified" in record) return "Subagent";
    if (typeof record.custom === "string" && record.custom.trim()) return record.custom.trim();
    const key = Object.keys(record)[0];
    if (key) return key.charAt(0).toUpperCase() + key.slice(1);
  }
  return "Subagent";
}

export function resolveCreatePlanKbPath(args: unknown): string | null {
  const record = asRecord(args);
  if (!record) return null;
  const uri = stringField(record, "planUri") ?? stringField(record, "plan_uri");
  if (uri) return normalizeDocsPath(uri);
  const plan = stringField(record, "plan");
  if (!plan) return null;
  const mdLink = plan.match(/\(([^)]*docs\/[^)]+\.md)\)/);
  if (mdLink?.[1]) return normalizeDocsPath(mdLink[1]);
  const bare = plan.match(/(?:^|\s)((?:[\w.-]+\/)*docs\/[\w./-]+\.md)/);
  if (bare?.[1]) return normalizeDocsPath(bare[1]);
  return null;
}

function normalizeDocsPath(raw: string): string {
  return raw.replace(/^\.?\//, "").trim();
}

function truncateMeta(value: string | null): string | null {
  if (!value) return null;
  return value.length > 80 ? `${value.slice(0, 79)}…` : value;
}

function isTaskName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === "task" || normalized === "cursor/task";
}

function isPlanName(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/_/g, "");
  return (
    normalized === "createplan" ||
    normalized === "cursor/createplan" ||
    name === "CreatePlan"
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function inferToolNameFromPayload(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const text = payload.trim();
  if (!text) return null;

  if (text.includes("Glob pattern") && text.includes("matches every file")) return "Glob";
  if (text.includes('"glob_pattern"') || text.includes("glob_pattern")) return "Glob";

  return null;
}

function humanizeToolName(value: string): string {
  const words = value.replace(/_/g, " ").split(" ").filter(Boolean).join(" ");
  if (!words) return value;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
