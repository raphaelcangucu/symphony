import type { AgentExecutionStatus } from "@/types/agent-execution";
import type { IssueDevServerStatus } from "@/types/issue";
import type { RecentStatusKind } from "@/types/recents";

/**
 * Semantic status tones shared by every status badge/dot in the app. Domain
 * components map their statuses to a tone instead of hand-picking Tailwind
 * palette classes, so status colors stay consistent across sessions,
 * launcher, recents and dev-server surfaces.
 */
export type StatusTone =
  | "success"
  | "attention"
  | "warning"
  | "info"
  | "accent"
  | "neutral"
  | "destructive"
  | "muted";

export const STATUS_PILL_BASE = "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium";

const TONE_BADGE_CLASS: Record<StatusTone, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  attention: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  info: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  accent: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  neutral: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  destructive: "border-destructive/40 bg-destructive/10 text-destructive",
  muted: "border-muted bg-muted text-muted-foreground",
};

const TONE_DOT_CLASS: Record<StatusTone, string> = {
  success: "bg-emerald-500",
  attention: "bg-orange-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
  accent: "bg-sky-500",
  neutral: "bg-slate-400",
  destructive: "bg-red-500",
  muted: "bg-muted-foreground",
};

export function statusToneBadgeClass(tone: StatusTone): string {
  return TONE_BADGE_CLASS[tone];
}

export function statusToneDotClass(tone: StatusTone, options?: { pulse?: boolean }): string {
  return options?.pulse ? `${TONE_DOT_CLASS[tone]} animate-pulse` : TONE_DOT_CLASS[tone];
}

interface ExecutionStatusPresentation {
  badge: StatusTone;
  dot: StatusTone;
  pulse: boolean;
}

const EXECUTION_STATUS_TONES: Record<AgentExecutionStatus, ExecutionStatusPresentation> = {
  live: { badge: "success", dot: "success", pulse: true },
  retrying: { badge: "success", dot: "attention", pulse: true },
  waiting: { badge: "warning", dot: "warning", pulse: false },
  idle: { badge: "warning", dot: "neutral", pulse: false },
  saved: { badge: "neutral", dot: "neutral", pulse: false },
  paused: { badge: "accent", dot: "warning", pulse: false },
  error: { badge: "destructive", dot: "destructive", pulse: false },
  aborted: { badge: "destructive", dot: "destructive", pulse: false },
};

export function executionStatusBadgeClass(status: AgentExecutionStatus): string {
  return statusToneBadgeClass(EXECUTION_STATUS_TONES[status].badge);
}

export function executionStatusDotClass(status: AgentExecutionStatus): string {
  const { dot, pulse } = EXECUTION_STATUS_TONES[status];
  return statusToneDotClass(dot, { pulse });
}

/** Dot class for loosely-typed status strings (e.g. launcher rows); unknown statuses render neutral. */
export function looseExecutionStatusDotClass(status: string): string {
  if (status in EXECUTION_STATUS_TONES) {
    return executionStatusDotClass(status as AgentExecutionStatus);
  }
  return statusToneDotClass("neutral");
}

const RECENT_STATUS_TONES: Record<RecentStatusKind, StatusTone> = {
  running: "success",
  retrying: "attention",
  waiting: "warning",
  idle: "neutral",
  active: "accent",
  in_progress: "info",
  todo: "neutral",
  done: "success",
  closed: "neutral",
  error: "destructive",
  aborted: "destructive",
};

export function recentStatusBadgeClass(status: RecentStatusKind): string {
  return statusToneBadgeClass(RECENT_STATUS_TONES[status]);
}

const DEV_SERVER_STATUS_TONES: Record<IssueDevServerStatus, StatusTone> = {
  crashed: "destructive",
  pending: "neutral",
  provisioning: "info",
  ready: "success",
  starting: "info",
  stopped: "muted",
};

export function devServerStatusBadgeClass(status: IssueDevServerStatus): string {
  return statusToneBadgeClass(DEV_SERVER_STATUS_TONES[status]);
}
