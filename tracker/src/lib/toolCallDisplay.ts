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
