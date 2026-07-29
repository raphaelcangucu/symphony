import type { AssistantToolCall, AssistantToolStatus } from "@/services/assistant";

export type FileActivityKind = "read" | "edit" | "command";

export interface FileActivityView {
  kind: FileActivityKind;
  /** Primary label: filename, "N files", or the command. */
  title: string;
  /** Single-file path for read/edit; null for multi-file or command. */
  path: string | null;
  /** "L1–60" / "L5–" / "L–9" for reads; null otherwise. */
  lineRange: string | null;
  additions: number | null;
  deletions: number | null;
  status: "running" | "complete" | "error";
  body: { value: string; language: "diff" | "bash" | "text" } | null;
}

const READ_TOOLS = new Set(["read_workspace_file", "read_file", "Read", "read"]);
const EDIT_TOOLS = new Set(["apply_patch", "edit_file", "write_file", "edit", "write", "Write"]);
const COMMAND_TOOLS = new Set(["shell", "exec_command", "bash", "Bash", "Shell"]);

export function fileActivityFromToolCall(call: AssistantToolCall): FileActivityView | null {
  const status = mapStatus(call.status);
  if (READ_TOOLS.has(call.name)) return readView(call, status);
  if (EDIT_TOOLS.has(call.name)) return editView(call, status);
  if (COMMAND_TOOLS.has(call.name)) return commandView(call, status);
  return null;
}

function mapStatus(status: AssistantToolStatus): FileActivityView["status"] {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "complete";
}

function readView(call: AssistantToolCall, status: FileActivityView["status"]): FileActivityView {
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const path = stringOrNull(args.path);
  const start = numberOrNull(args.start_line);
  const end = numberOrNull(args.end_line);
  return {
    kind: "read",
    title: path ?? "file",
    path,
    lineRange: lineRange(start, end),
    additions: null,
    deletions: null,
    status,
    body: call.output ? { value: call.output, language: "text" } : null,
  };
}

function editView(call: AssistantToolCall, status: FileActivityView["status"]): FileActivityView {
  const result = (call.result ?? {}) as Record<string, unknown>;
  const paths = Array.isArray(result.paths) ? (result.paths.filter((p) => typeof p === "string") as string[]) : [];
  const single = paths.length === 1 ? paths[0] : null;
  const diff = stringOrNull(result.diff);
  return {
    kind: "edit",
    title: single ?? (paths.length > 1 ? `${paths.length} files` : "file"),
    path: single,
    lineRange: null,
    additions: numberOrNull(result.additions),
    deletions: numberOrNull(result.deletions),
    status,
    body: diff ? { value: diff, language: "diff" } : null,
  };
}

function commandView(call: AssistantToolCall, status: FileActivityView["status"]): FileActivityView {
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const description = stringOrNull(args.description);
  const command = stringOrNull(args.command) ?? "";
  return {
    kind: "command",
    title: description ?? (command ? commandDisplayTitle(command) : "command"),
    path: null,
    lineRange: null,
    additions: null,
    deletions: null,
    status,
    body: call.output ? { value: call.output, language: "bash" } : null,
  };
}

function commandDisplayTitle(command: string): string {
  const wrapped = command.match(/^\/bin\/zsh -lc '([\s\S]*)'$/);
  return wrapped?.[1] ?? command;
}

function lineRange(start: number | null, end: number | null): string | null {
  if (start == null && end == null) return null;
  return `L${start ?? ""}–${end ?? ""}`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
