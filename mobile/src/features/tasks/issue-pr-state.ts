import type { PullRequest } from "@/api/contracts";

export type PullRequestHealthTone = "success" | "warning" | "failure";

export type PullRequestHealth = {
  checks: Array<{ label: string; tone: PullRequestHealthTone }>;
  problemCount: number;
  tone: PullRequestHealthTone;
};

type PullRequestHealthInput = Pick<
  PullRequest,
  "checksState" | "mergeable" | "pipelines" | "statuses"
>;

export function pullRequestHealth(input: PullRequestHealthInput): PullRequestHealth {
  const checks = [
    ...input.pipelines.flatMap((pipeline) =>
      pipeline.jobs.map((job) => ({
        label: job.name?.trim() || pipeline.name,
        tone: checkTone(job.status, job.conclusion),
      })),
    ),
    ...input.statuses.map((status) => ({
      label: status.context?.trim() || "Status",
      tone: checkTone(status.state, status.state),
    })),
  ];
  const failedChecks = checks.filter((check) => check.tone === "failure").length;
  const mergeConflict = input.mergeable?.toLowerCase() === "conflicting" ? 1 : 0;
  const problemCount = failedChecks + mergeConflict;
  const hasWarning =
    checks.some((check) => check.tone === "warning") ||
    input.checksState?.toLowerCase() === "pending";

  return {
    checks,
    problemCount,
    tone: problemCount > 0 ? "failure" : hasWarning ? "warning" : "success",
  };
}

function checkTone(status: string | null, conclusion: string | null): PullRequestHealthTone {
  const normalized = (conclusion || status || "").toLowerCase();
  if (["success", "successful", "passed", "neutral", "skipped"].includes(normalized)) {
    return "success";
  }
  if (["failure", "failed", "error", "cancelled", "canceled", "timed_out"].includes(normalized)) {
    return "failure";
  }
  return "warning";
}
