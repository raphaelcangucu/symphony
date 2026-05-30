export type PullRequestState = "open" | "closed" | "merged" | "draft" | "unknown";

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

export interface PullRequest {
  number: number;
  title: string | null;
  url: string | null;
  state: PullRequestState;
  rawState: string | null;
  isDraft: boolean;
  merged: boolean;
  headRef: string | null;
  baseRef: string | null;
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  mergedAt: string | null;
  checksState: string | null;
  pipelines: PullRequestPipeline[];
  statuses: PullRequestStatusContext[];
  conversation: PullRequestConversationEntry[];
}

export interface PullRequestResult {
  data: PullRequest[];
  supported: boolean;
  available: boolean;
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
