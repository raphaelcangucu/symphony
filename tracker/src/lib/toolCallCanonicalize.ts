import type {
  ToolFamily,
  ToolPresentation,
  ToolPresentationBadge,
  ToolPresentationLink,
  ToolPresentationStatus,
} from "@/lib/toolCallPresentation";

export interface CanonicalToolInput {
  name: string;
  arguments?: Record<string, unknown> | null;
  output?: string | null;
  status?: string | null;
  result?: unknown;
  outputTruncated?: boolean;
  outputByteSize?: number | null;
}

type BuiltPresentation = Omit<
  ToolPresentation,
  "toolName" | "family" | "status" | "outputTruncated" | "outputByteSize"
>;

export function canonicalizeToolCall(input: CanonicalToolInput): ToolPresentation {
  const args = asRecord(input.arguments);
  const { toolName, innerArgs } = resolveToolNameAndArgs(input.name, args);
  const family = familyFor(toolName, innerArgs, input.output ?? null);
  const status = mapStatus(input.status);
  const unwrapped = unwrapOutput(input.output ?? null);
  const built = buildForFamily(family, toolName, innerArgs, unwrapped, status);
  return {
    ...built,
    toolName,
    family,
    status,
    outputTruncated: input.outputTruncated,
    outputByteSize: input.outputByteSize ?? null,
    raw: input.output ?? (Object.keys(args).length ? JSON.stringify(args, null, 2) : null),
  };
}

function resolveToolNameAndArgs(name: string, args: Record<string, unknown>) {
  if (name === "Mcp" || name === "mcp") {
    const toolName = stringOrNull(args.toolName) ?? stringOrNull(args.name) ?? "Mcp";
    const inner = asRecord(args.args) ?? args;
    return { toolName, innerArgs: inner };
  }
  return { toolName: name, innerArgs: args };
}

function familyFor(
  toolName: string,
  args: Record<string, unknown>,
  output: string | null,
): ToolFamily {
  const n = toolName.toLowerCase();
  if (["bash", "shell", "exec_command"].includes(n)) {
    if (isHealthWaitCommand(stringOrNull(args.command) ?? "")) return "preview";
    return "command";
  }
  if (["read", "read_file", "read_workspace_file"].includes(n)) return "file_read";
  if (["edit", "write", "apply_patch", "edit_file", "write_file"].includes(n)) return "file_edit";
  if (["grep", "glob", "semsearch", "semanticsearch"].includes(n)) return "search";
  if (n === "manage_preview" || n === "list_previews") return "preview";
  if (n === "get_evidence_status" || n === "check_handoff_gate") return "evidence";
  if (n === "update_acceptance_criteria") return "acceptance";
  if (n === "manage_dev_env") return "devenv";
  if (n === "manage_tunnel") return "tunnel";
  if (n.startsWith("kb_")) return "kb";
  if (
    n === "task" ||
    n === "todowrite" ||
    n === "taskcreate" ||
    n === "taskupdate" ||
    n === "update_plan"
  ) {
    return "task";
  }
  if (n === "createplan" || n === "create_plan" || n.includes("createplan")) return "create_plan";
  if (n === "set_issue_status" || n === "move_issue" || n.startsWith("dispatch_")) {
    return "board_action";
  }
  if (n.startsWith("list_") || n.startsWith("get_") || n === "list_comments") return "board_query";
  if (
    n.startsWith("create_") ||
    n.startsWith("update_") ||
    n.startsWith("add_") ||
    n.startsWith("delete_")
  ) {
    return "board_action";
  }
  void output;
  return "generic_mcp";
}

function buildForFamily(
  family: ToolFamily,
  toolName: string,
  innerArgs: Record<string, unknown>,
  unwrapped: unknown,
  status: ToolPresentationStatus | null,
): BuiltPresentation {
  void status;
  switch (family) {
    case "command":
      return buildCommandPresentation(toolName, innerArgs, unwrapped);
    case "preview":
      return buildPreviewPresentation(toolName, innerArgs, unwrapped);
    case "kb":
      return buildKbPresentation(toolName, innerArgs);
    default:
      return {
        title: toolName,
        summary: null,
        badges: [],
        links: [],
        body: null,
        meta: {},
        kbPath: null,
        raw: null,
      };
  }
}

function buildCommandPresentation(
  toolName: string,
  innerArgs: Record<string, unknown>,
  unwrapped: unknown,
): BuiltPresentation {
  const description = stringOrNull(innerArgs.description);
  const command = stringOrNull(innerArgs.command);
  const exitCode = extractExitCode(unwrapped);
  const meta: Record<string, unknown> = {};
  if (exitCode !== undefined) meta.exitCode = exitCode;

  const unwrappedRecord = asRecord(unwrapped);
  const stdout = stringOrNull(unwrappedRecord?.stdout);
  const interleavedOutput = stringOrNull(unwrappedRecord?.interleavedOutput);
  const links = extractPrLinks(stdout, interleavedOutput);

  return {
    title: description ?? command ?? toolName,
    summary: command,
    badges: [],
    links,
    body: stdout,
    meta,
    kbPath: null,
    raw: null,
  };
}

function buildPreviewPresentation(
  toolName: string,
  innerArgs: Record<string, unknown>,
  unwrapped: unknown,
): BuiltPresentation {
  const command = stringOrNull(innerArgs.command) ?? "";
  const description = stringOrNull(innerArgs.description);

  if (isHealthWaitCommand(command)) {
    const title =
      description && /health|aguard/i.test(description)
        ? description
        : "Waiting for health check";

    return {
      title,
      summary: command,
      badges: [],
      links: [],
      body: null,
      meta: { healthWait: true },
      kbPath: null,
      raw: null,
    };
  }

  const action = stringOrNull(innerArgs.action);
  const links = extractPreviewLinks(unwrapped);
  const meta: Record<string, unknown> = {};
  if (action) meta.action = action;

  return {
    title: action ? `${toolName}: ${action}` : toolName,
    summary: null,
    badges: [],
    links,
    body: null,
    meta,
    kbPath: null,
    raw: null,
  };
}

function buildKbPresentation(toolName: string, innerArgs: Record<string, unknown>): BuiltPresentation {
  const path = stringOrNull(innerArgs.path);
  const title = stringOrNull(innerArgs.title);
  const badges: ToolPresentationBadge[] = [];

  if (toolName.toLowerCase().startsWith("kb_delete_")) {
    badges.push({ kind: "warn", label: "Destructive" });
  }

  return {
    title: title ?? toolName,
    summary: null,
    badges,
    links: [],
    body: null,
    meta: {},
    kbPath: path,
    raw: null,
  };
}

export function isHealthWaitCommand(command: string): boolean {
  const lower = command.toLowerCase();
  if (!lower.includes("curl") || !lower.includes("sleep")) return false;
  return /\bseq\b/.test(lower) || /\bfor\s+/.test(lower);
}

function extractPrLinks(
  stdout: string | null,
  interleavedOutput: string | null,
): ToolPresentationLink[] {
  const links: ToolPresentationLink[] = [];
  const seen = new Set<string>();

  for (const text of [stdout, interleavedOutput]) {
    if (!text) continue;
    const items = parsePrArray(text);
    for (const item of items) {
      const number = item.number;
      const url = item.url;
      if (typeof number !== "number" || typeof url !== "string" || !url.includes("/pull/")) {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      links.push({ label: `PR #${number}`, href: url });
    }
  }

  return links;
}

function parsePrArray(text: string): Array<{ number?: unknown; url?: unknown }> {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[")) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === "object") as Array<{
      number?: unknown;
      url?: unknown;
    }>;
  } catch {
    return [];
  }
}

function extractExitCode(unwrapped: unknown): number | undefined {
  const record = asRecord(unwrapped);
  if (record && typeof record.exitCode === "number") return record.exitCode;
  return undefined;
}

function extractPreviewLinks(unwrapped: unknown): ToolPresentationLink[] {
  const links: ToolPresentationLink[] = [];
  const record = asRecord(unwrapped);
  if (!record) return links;

  const data = asRecord(record.data) ?? record;
  const servers = data.servers;
  if (!Array.isArray(servers)) return links;

  for (const server of servers) {
    const serverRecord = asRecord(server);
    const url = stringOrNull(serverRecord?.url);
    if (url) {
      links.push({ label: url, href: url });
    }
  }

  return links;
}

function unwrapOutput(output: string | null): unknown {
  if (!output) return null;

  try {
    return unwrapParsed(JSON.parse(output));
  } catch {
    return output;
  }
}

function unwrapParsed(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;

  if ("success" in record) {
    return unwrapParsed(record.success);
  }

  if (Array.isArray(record.content)) {
    for (const item of record.content) {
      const itemRecord = asRecord(item);
      const textRecord = asRecord(itemRecord?.text);
      const innerText = stringOrNull(textRecord?.text);
      if (innerText) {
        try {
          return unwrapParsed(JSON.parse(innerText));
        } catch {
          return innerText;
        }
      }
    }
  }

  return value;
}

function mapStatus(status: string | null | undefined): ToolPresentationStatus | null {
  if (!status) return null;
  const normalized = status.trim().toLowerCase();
  if (normalized === "running" || normalized === "in_progress") return "running";
  if (
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "success" ||
    normalized === "done"
  ) {
    return "completed";
  }
  if (normalized === "failed" || normalized === "error") return "failed";
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
