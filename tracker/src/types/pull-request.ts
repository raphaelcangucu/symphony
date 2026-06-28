import type { Issue } from "./issue";

export type PullRequestState = "open" | "closed" | "merged" | "draft" | "unknown";
export type PullRequestMergeMethod = "merge" | "squash" | "rebase";
export type PullRequestMergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export type CheckStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "PENDING" | "WAITING" | string | null;

export type CheckConclusion =
  | "SUCCESS"
  | "FAILURE"
  | "NEUTRAL"
  | "CANCELLED"
  | "SKIPPED"
  | "TIMED_OUT"
  | "ACTION_REQUIRED"
  | "STALE"
  | "STARTUP_FAILURE"
  | string
  | null;

export interface PullRequestJob {
  name: string | null;
  status: CheckStatus;
  conclusion: CheckConclusion;
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PullRequestPipeline {
  name: string;
  url: string | null;
  jobs: PullRequestJob[];
}

export interface PullRequestStatusContext {
  context: string | null;
  state: string | null;
  url: string | null;
  description: string | null;
}

export interface PullRequestConversationEntry {
  author: string | null;
  body: string;
  kind: "comment" | "review";
  reviewState: string | null;
  createdAt: string | null;
}

export type PullRequestOrigin = "auto" | "manual";

export interface PullRequestMonitorInfo {
  lastAction: string | null;
  summary: string | null;
  autoReworkCount: number;
  lastActionAt: string | null;
}

export interface RerunResult {
  runId: number;
  ok: boolean;
  error?: string;
  status?: number;
}

export interface PullRequest {
  number: number;
  title: string | null;
  url: string | null;
  state: PullRequestState;
  repo: string | null;
  origin: PullRequestOrigin;
  rawState: string | null;
  isDraft: boolean;
  merged: boolean;
  headRef: string | null;
  baseRef: string | null;
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  mergedAt: string | null;
  // GitHub mergeability: "CONFLICTING" means the branch conflicts with its base.
  // May be "UNKNOWN"/null while GitHub computes it (resolves on a later refresh).
  mergeable: PullRequestMergeable | string | null;
  checksState: string | null;
  pipelines: PullRequestPipeline[];
  statuses: PullRequestStatusContext[];
  conversation: PullRequestConversationEntry[];
  baseBehindBy: number | null;
  monitor: PullRequestMonitorInfo | null;
}

// A parent issue's sub-issue and the pull requests linked to that child, so the
// parent view can consolidate the whole subtask tree's PRs.
export interface PullRequestGroup {
  identifier: string;
  title: string | null;
  pullRequests: PullRequest[];
}

export interface PullRequestResult {
  data: PullRequest[];
  supported: boolean;
  available: boolean;
  children: PullRequestGroup[];
}

export interface PullRequestFixJob {
  name: string | null;
  conclusion: string | null;
  url: string | null;
}

export interface PullRequestFixResult {
  movedTo: string;
  commentPosted: boolean;
  jobs: PullRequestFixJob[];
}

export interface UpdateBranchResult {
  updated: boolean;
}

export interface MergePullRequestInput {
  method: PullRequestMergeMethod;
  bypass?: boolean;
}

export interface MergePullRequestResult {
  merged: boolean;
  method: PullRequestMergeMethod;
  bypass: boolean;
  sha?: string | null;
  message?: string | null;
  issue: Issue | null;
}
