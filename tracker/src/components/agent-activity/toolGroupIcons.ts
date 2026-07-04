import { FileText, type LucideIcon, Pencil, Search, TerminalSquare, Wrench, Zap } from "lucide-react";

import type { ToolGroupKind } from "@/lib/toolCallGroups";

/** Shared icon per tool-group kind, reused by assistant and session-log tool groups. */
export const TOOL_GROUP_ICON: Record<ToolGroupKind, LucideIcon> = {
  read: FileText,
  edit: Pencil,
  command: TerminalSquare,
  query: Search,
  action: Zap,
  other: Wrench,
};
