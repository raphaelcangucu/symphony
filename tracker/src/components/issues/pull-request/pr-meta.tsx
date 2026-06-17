import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Loader2,
  MinusCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import type { PullRequest, PullRequestJob, PullRequestState } from "@/types/pull-request";

export interface VisualMeta {
  Icon: LucideIcon;
  label: string;
  className: string;
  spin?: boolean;
}

const PR_STATE_META: Record<PullRequestState, VisualMeta> = {
  open: { Icon: GitPullRequest, label: "Open", className: "text-emerald-600 dark:text-emerald-400" },
  draft: { Icon: GitPullRequestDraft, label: "Draft", className: "text-muted-foreground" },
  merged: { Icon: GitMerge, label: "Merged", className: "text-violet-600 dark:text-violet-400" },
  closed: { Icon: GitPullRequestClosed, label: "Closed", className: "text-rose-600 dark:text-rose-400" },
  unknown: { Icon: GitPullRequest, label: "Pull request", className: "text-muted-foreground" },
};

export function prStateMeta(state: PullRequestState): VisualMeta {
  return PR_STATE_META[state] ?? PR_STATE_META.unknown;
}

const SUCCESS: VisualMeta = { Icon: CheckCircle2, label: "Passed", className: "text-emerald-600 dark:text-emerald-400" };
const FAILURE: VisualMeta = { Icon: XCircle, label: "Failed", className: "text-rose-600 dark:text-rose-400" };
const RUNNING: VisualMeta = { Icon: Loader2, label: "Running", className: "text-amber-600 dark:text-amber-400", spin: true };
const PENDING: VisualMeta = { Icon: Clock, label: "Pending", className: "text-amber-600 dark:text-amber-400" };
const NEUTRAL: VisualMeta = { Icon: MinusCircle, label: "Neutral", className: "text-muted-foreground" };
const SKIPPED: VisualMeta = { Icon: CircleSlash, label: "Skipped", className: "text-muted-foreground" };
const ACTION: VisualMeta = { Icon: AlertCircle, label: "Action required", className: "text-amber-600 dark:text-amber-400" };

export function jobMeta(job: Pick<PullRequestJob, "status" | "conclusion">): VisualMeta {
  const status = (job.status ?? "").toUpperCase();
  if (status && status !== "COMPLETED") {
    return status === "QUEUED" || status === "WAITING" || status === "PENDING" ? PENDING : RUNNING;
  }
  return conclusionMeta(job.conclusion);
}

export function conclusionMeta(conclusion: string | null | undefined): VisualMeta {
  switch ((conclusion ?? "").toUpperCase()) {
    case "SUCCESS":
      return SUCCESS;
    case "FAILURE":
    case "TIMED_OUT":
    case "STARTUP_FAILURE":
      return FAILURE;
    case "CANCELLED":
    case "STALE":
      return NEUTRAL;
    case "SKIPPED":
      return SKIPPED;
    case "ACTION_REQUIRED":
      return ACTION;
    case "NEUTRAL":
      return NEUTRAL;
    case "":
      return PENDING;
    default:
      return NEUTRAL;
  }
}

export function rollupMeta(state: string | null | undefined): VisualMeta {
  switch ((state ?? "").toUpperCase()) {
    case "SUCCESS":
      return { ...SUCCESS, label: "All checks passed" };
    case "FAILURE":
    case "ERROR":
      return { ...FAILURE, label: "Some checks failed" };
    case "PENDING":
    case "EXPECTED":
      return { ...RUNNING, label: "Checks running" };
    default:
      return { ...NEUTRAL, label: "No checks" };
  }
}

const STATUS_STATE_META: Record<string, VisualMeta> = {
  SUCCESS,
  FAILURE,
  ERROR: FAILURE,
  PENDING,
  EXPECTED: PENDING,
};

export function statusStateMeta(state: string | null | undefined): VisualMeta {
  return STATUS_STATE_META[(state ?? "").toUpperCase()] ?? NEUTRAL;
}

const FAILING_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"]);

export function hasFailingChecks(pr: PullRequest): boolean {
  return pr.pipelines.some((pipeline) =>
    pipeline.jobs.some((job) => job.conclusion != null && FAILING_CONCLUSIONS.has(job.conclusion.toUpperCase())),
  );
}

export const MERGE_CONFLICT_META: VisualMeta = {
  Icon: AlertTriangle,
  label: "Conflicts",
  className: "text-rose-600 dark:text-rose-400",
};

// True when GitHub reports the branch conflicts with its base. Only meaningful
// for live PRs (open/draft); merged/closed PRs report a stale mergeable value.
export function hasMergeConflicts(pr: PullRequest): boolean {
  if (pr.state !== "open" && pr.state !== "draft") return false;
  return (pr.mergeable ?? "").toUpperCase() === "CONFLICTING";
}
