import type { TFunction } from "i18next";
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

import { i18n } from "@/i18n";
import type { PullRequest, PullRequestJob, PullRequestState } from "@/types/pull-request";

export interface VisualMeta {
  Icon: LucideIcon;
  label: string;
  className: string;
  spin?: boolean;
}

type Translate = TFunction;

function jobVisual(
  Icon: LucideIcon,
  labelKey: string,
  className: string,
  t: Translate,
  spin?: boolean,
): VisualMeta {
  return { Icon, label: t(labelKey), className, spin };
}

function passedMeta(t: Translate): VisualMeta {
  return jobVisual(CheckCircle2, "issue.pullRequest.meta.job.passed", "text-emerald-600 dark:text-emerald-400", t);
}

function failedMeta(t: Translate): VisualMeta {
  return jobVisual(XCircle, "issue.pullRequest.meta.job.failed", "text-rose-600 dark:text-rose-400", t);
}

function runningMeta(t: Translate): VisualMeta {
  return jobVisual(
    Loader2,
    "issue.pullRequest.meta.job.running",
    "text-amber-600 dark:text-amber-400",
    t,
    true,
  );
}

function pendingMeta(t: Translate): VisualMeta {
  return jobVisual(Clock, "issue.pullRequest.meta.job.pending", "text-amber-600 dark:text-amber-400", t);
}

function neutralMeta(t: Translate): VisualMeta {
  return jobVisual(MinusCircle, "issue.pullRequest.meta.job.neutral", "text-muted-foreground", t);
}

function skippedMeta(t: Translate): VisualMeta {
  return jobVisual(CircleSlash, "issue.pullRequest.meta.job.skipped", "text-muted-foreground", t);
}

function actionMeta(t: Translate): VisualMeta {
  return jobVisual(
    AlertCircle,
    "issue.pullRequest.meta.job.actionRequired",
    "text-amber-600 dark:text-amber-400",
    t,
  );
}

export function prStateMeta(
  state: PullRequestState,
  t: Translate = i18n.t.bind(i18n) as Translate,
): VisualMeta {
  const meta: Record<PullRequestState, VisualMeta> = {
    open: {
      Icon: GitPullRequest,
      label: t("issue.pullRequest.meta.state.open"),
      className: "text-emerald-600 dark:text-emerald-400",
    },
    draft: {
      Icon: GitPullRequestDraft,
      label: t("issue.pullRequest.meta.state.draft"),
      className: "text-muted-foreground",
    },
    merged: {
      Icon: GitMerge,
      label: t("issue.pullRequest.meta.state.merged"),
      className: "text-violet-600 dark:text-violet-400",
    },
    closed: {
      Icon: GitPullRequestClosed,
      label: t("issue.pullRequest.meta.state.closed"),
      className: "text-rose-600 dark:text-rose-400",
    },
    unknown: {
      Icon: GitPullRequest,
      label: t("issue.pullRequest.meta.state.unknown"),
      className: "text-muted-foreground",
    },
  };
  return meta[state] ?? meta.unknown;
}

export function jobMeta(
  job: Pick<PullRequestJob, "status" | "conclusion">,
  t: Translate = i18n.t.bind(i18n) as Translate,
): VisualMeta {
  const status = (job.status ?? "").toUpperCase();
  if (status && status !== "COMPLETED") {
    return status === "QUEUED" || status === "WAITING" || status === "PENDING" ? pendingMeta(t) : runningMeta(t);
  }
  return conclusionMeta(job.conclusion, t);
}

export function conclusionMeta(
  conclusion: string | null | undefined,
  t: Translate = i18n.t.bind(i18n) as Translate,
): VisualMeta {
  switch ((conclusion ?? "").toUpperCase()) {
    case "SUCCESS":
      return passedMeta(t);
    case "FAILURE":
    case "TIMED_OUT":
    case "STARTUP_FAILURE":
      return failedMeta(t);
    case "CANCELLED":
    case "STALE":
      return neutralMeta(t);
    case "SKIPPED":
      return skippedMeta(t);
    case "ACTION_REQUIRED":
      return actionMeta(t);
    case "NEUTRAL":
      return neutralMeta(t);
    case "":
      return pendingMeta(t);
    default:
      return neutralMeta(t);
  }
}

export function rollupMeta(
  state: string | null | undefined,
  t: Translate = i18n.t.bind(i18n) as Translate,
): VisualMeta {
  switch ((state ?? "").toUpperCase()) {
    case "SUCCESS":
      return { ...passedMeta(t), label: t("issue.pullRequest.meta.rollup.allPassed") };
    case "FAILURE":
    case "ERROR":
      return { ...failedMeta(t), label: t("issue.pullRequest.meta.rollup.someFailed") };
    case "PENDING":
    case "EXPECTED":
      return { ...runningMeta(t), label: t("issue.pullRequest.meta.rollup.checksRunning") };
    default:
      return { ...neutralMeta(t), label: t("issue.pullRequest.meta.rollup.noChecks") };
  }
}

export function statusStateMeta(
  state: string | null | undefined,
  t: Translate = i18n.t.bind(i18n) as Translate,
): VisualMeta {
  switch ((state ?? "").toUpperCase()) {
    case "SUCCESS":
      return passedMeta(t);
    case "FAILURE":
    case "ERROR":
      return failedMeta(t);
    case "PENDING":
    case "EXPECTED":
      return pendingMeta(t);
    default:
      return neutralMeta(t);
  }
}

export function mergeConflictMeta(t: Translate = i18n.t.bind(i18n) as Translate): VisualMeta {
  return {
    Icon: AlertTriangle,
    label: t("issue.pullRequest.meta.conflicts"),
    className: "text-rose-600 dark:text-rose-400",
  };
}

export type JobOutcomeCategory = "passed" | "failed" | "running" | "other";

export function jobOutcomeCategory(job: Pick<PullRequestJob, "status" | "conclusion">): JobOutcomeCategory {
  const status = (job.status ?? "").toUpperCase();
  if (status && status !== "COMPLETED") {
    return "running";
  }
  switch ((job.conclusion ?? "").toUpperCase()) {
    case "SUCCESS":
      return "passed";
    case "FAILURE":
    case "TIMED_OUT":
    case "STARTUP_FAILURE":
      return "failed";
    case "ACTION_REQUIRED":
      return "failed";
    default:
      return "other";
  }
}

const FAILING_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"]);

export function hasFailingChecks(pr: PullRequest): boolean {
  return pr.pipelines.some((pipeline) =>
    pipeline.jobs.some((job) => job.conclusion != null && FAILING_CONCLUSIONS.has(job.conclusion.toUpperCase())),
  );
}

// True when GitHub reports the branch conflicts with its base. Only meaningful
// for live PRs (open/draft); merged/closed PRs report a stale mergeable value.
export function hasMergeConflicts(pr: PullRequest): boolean {
  if (pr.state !== "open" && pr.state !== "draft") return false;
  return (pr.mergeable ?? "").toUpperCase() === "CONFLICTING";
}
