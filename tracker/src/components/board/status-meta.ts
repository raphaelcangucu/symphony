import {
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  GitMerge,
  RotateCcw,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import type { WorkflowStatusCategory, WorkflowStatusName } from "@/types/workflow-status";

export interface StatusMeta {
  Icon: LucideIcon;
  /** Icon / accent foreground colour. */
  iconClass: string;
  /** Solid dot colour used on collapsed columns and headers. */
  dotClass: string;
  /** Thin accent bar shown on top of an expanded column. */
  accentClass: string;
  /** Subtle tinted background for the column body. */
  surfaceClass: string;
}

type StatusKind =
  | "backlog"
  | "todo"
  | "in_progress"
  | "review"
  | "merging"
  | "rework"
  | "done"
  | "canceled";

const KIND_META: Record<StatusKind, StatusMeta> = {
  backlog: {
    Icon: CircleDashed,
    iconClass: "text-slate-400",
    dotClass: "bg-slate-400",
    accentClass: "bg-slate-400/60",
    surfaceClass: "bg-slate-500/[0.04]",
  },
  todo: {
    Icon: Circle,
    iconClass: "text-zinc-500",
    dotClass: "bg-zinc-500",
    accentClass: "bg-zinc-500/60",
    surfaceClass: "bg-zinc-500/[0.04]",
  },
  in_progress: {
    Icon: CircleDot,
    iconClass: "text-amber-500",
    dotClass: "bg-amber-500",
    accentClass: "bg-amber-500/70",
    surfaceClass: "bg-amber-500/[0.06]",
  },
  review: {
    Icon: CircleDotDashed,
    iconClass: "text-violet-500",
    dotClass: "bg-violet-500",
    accentClass: "bg-violet-500/70",
    surfaceClass: "bg-violet-500/[0.06]",
  },
  merging: {
    Icon: GitMerge,
    iconClass: "text-sky-500",
    dotClass: "bg-sky-500",
    accentClass: "bg-sky-500/70",
    surfaceClass: "bg-sky-500/[0.06]",
  },
  rework: {
    Icon: RotateCcw,
    iconClass: "text-orange-500",
    dotClass: "bg-orange-500",
    accentClass: "bg-orange-500/70",
    surfaceClass: "bg-orange-500/[0.06]",
  },
  done: {
    Icon: CheckCircle2,
    iconClass: "text-emerald-500",
    dotClass: "bg-emerald-500",
    accentClass: "bg-emerald-500/70",
    surfaceClass: "bg-emerald-500/[0.06]",
  },
  canceled: {
    Icon: XCircle,
    iconClass: "text-rose-500",
    dotClass: "bg-rose-500",
    accentClass: "bg-rose-500/70",
    surfaceClass: "bg-rose-500/[0.06]",
  },
};

const CATEGORY_TO_KIND: Record<WorkflowStatusCategory, StatusKind> = {
  backlog: "backlog",
  unstarted: "todo",
  started: "in_progress",
  active: "merging",
  wait: "review",
  completed: "done",
  terminal: "done",
  canceled: "canceled",
};

function kindFromName(name: string): StatusKind | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("backlog")) return "backlog";
  if (normalized.includes("cancel")) return "canceled";
  if (normalized.includes("done") || normalized.includes("complete") || normalized.includes("closed")) return "done";
  if (normalized.includes("merg")) return "merging";
  if (normalized.includes("rework") || normalized.includes("changes")) return "rework";
  if (normalized.includes("review") || normalized.includes("qa") || normalized.includes("approval")) return "review";
  if (normalized.includes("progress") || normalized.includes("doing") || normalized.includes("started")) return "in_progress";
  if (normalized.includes("todo") || normalized.includes("to do") || normalized.includes("ready") || normalized.includes("open")) {
    return "todo";
  }
  return null;
}

export function getStatusMeta(name: WorkflowStatusName, category?: WorkflowStatusCategory | null): StatusMeta {
  const byName = kindFromName(name);
  if (byName) return KIND_META[byName];
  if (category && CATEGORY_TO_KIND[category]) return KIND_META[CATEGORY_TO_KIND[category]];
  return KIND_META.todo;
}
