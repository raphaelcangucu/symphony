import type { SubagentRef } from "@/lib/subagentRef";

export const TOOL_FAMILIES = [
  "command",
  "file_read",
  "file_edit",
  "search",
  "preview",
  "board_query",
  "board_action",
  "evidence",
  "acceptance",
  "kb",
  "devenv",
  "tunnel",
  "task",
  "spawn_agent",
  "create_plan",
  "generic_mcp",
  "other",
] as const;

export type ToolFamily = (typeof TOOL_FAMILIES)[number];

export function isToolFamily(value: string): value is ToolFamily {
  return (TOOL_FAMILIES as readonly string[]).includes(value);
}

export type ToolPresentationStatus = "running" | "completed" | "failed";

export interface ToolPresentationBadge {
  kind: "ok" | "warn" | "run" | "fail" | "neutral";
  label: string;
}

export interface ToolPresentationLink {
  label: string;
  href: string;
}

export interface ToolPresentation {
  family: ToolFamily;
  /** Resolved tool name after Mcp→toolName unwrap (e.g. manage_preview). */
  toolName: string;
  title: string;
  summary: string | null;
  status: ToolPresentationStatus | null;
  badges: ToolPresentationBadge[];
  links: ToolPresentationLink[];
  /** Short human body (stdout head, steps text, etc.). */
  body: string | null;
  /** Full raw for “Detalhes técnicos”. */
  raw: string | null;
  /** Structured extras for specialized cards. */
  meta: Record<string, unknown>;
  /** Canonical child-agent reference when this tool call spawns a subagent. */
  subagentRef?: SubagentRef;
  outputTruncated?: boolean;
  outputByteSize?: number | null;
  kbPath?: string | null;
}
