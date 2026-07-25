import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import type {
  MergePullRequestInput,
  PullRequest,
  PullRequestFixResult,
  PullRequestRerunResult,
} from "@/api/contracts";
import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";

import { PullRequestScreen } from "./PullRequestScreen";

type Notice = {
  error: boolean;
  message: string;
};

type Operation = {
  run(): Promise<unknown>;
  notice(result: unknown): Notice;
};

export function PullRequestRoute() {
  const params = useLocalSearchParams<{
    projectSlug?: string | string[];
    identifier?: string | string[];
  }>();
  const router = useRouter();
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const queryClient = useQueryClient();
  const projectSlug = firstParam(params.projectSlug);
  const identifier = firstParam(params.identifier);
  const [notice, setNotice] = useState<Notice | null>(null);
  const queryKey = ["issue-pull-requests", activeProfile?.id, projectSlug, identifier] as const;
  const pullRequests = useQuery({
    queryKey,
    enabled: Boolean(client && projectSlug && identifier),
    queryFn: ({ signal }) => client!.issuePullRequests(projectSlug!, identifier!, true, signal),
  });
  const operation = useMutation({
    mutationFn: (input: Operation) => input.run(),
    onSuccess: async (result, input) => {
      setNotice(input.notice(result));
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  if (!client || !projectSlug || !identifier) return null;

  const run = (input: Operation) => {
    setNotice(null);
    operation.mutate(input);
  };
  const onLink = (url: string) =>
    run({
      run: () => client.linkIssuePullRequest(projectSlug, identifier, url),
      notice: () => ({ error: false, message: "Pull request linked." }),
    });
  const onUnlink = (pullRequest: PullRequest) =>
    run({
      run: async () => {
        if (!pullRequest.url) throw new Error("This pull request has no URL to unlink.");
        await client.unlinkIssuePullRequest(projectSlug, identifier, pullRequest.url);
      },
      notice: () => ({ error: false, message: `PR #${pullRequest.number} unlinked.` }),
    });
  const onFix = (pullRequest: PullRequest) =>
    run({
      run: () => client.requestPullRequestFix(projectSlug, identifier),
      notice: (result) => {
        const fix = result as PullRequestFixResult;
        return {
          error: false,
          message: `PR #${pullRequest.number} sent to ${fix.movedTo}.`,
        };
      },
    });
  const onUpdateBranch = (pullRequest: PullRequest) =>
    run({
      run: () => client.updatePullRequestBranch(projectSlug, identifier, pullRequest.number),
      notice: () => ({
        error: false,
        message: `Branch update requested for PR #${pullRequest.number}.`,
      }),
    });
  const onRerun = (pullRequest: PullRequest) =>
    run({
      run: () => client.rerunPullRequestJobs(projectSlug, identifier, pullRequest.number),
      notice: (result) => rerunNotice(pullRequest, result as PullRequestRerunResult[]),
    });
  const onMerge = (pullRequest: PullRequest, input: MergePullRequestInput) =>
    run({
      run: () => client.mergeIssuePullRequest(projectSlug, identifier, pullRequest.number, input),
      notice: (result) => {
        const merged = result as Awaited<ReturnType<typeof client.mergeIssuePullRequest>>;
        return merged.merged
          ? { error: false, message: `PR #${pullRequest.number} merged with ${merged.method}.` }
          : {
              error: true,
              message: merged.message ?? `PR #${pullRequest.number} was not merged.`,
            };
      },
    });
  const requestError = pullRequests.error ?? operation.error;

  return (
    <PullRequestScreen
      busy={operation.isPending}
      error={requestError instanceof Error ? requestError.message : null}
      loading={pullRequests.isLoading}
      notice={notice?.message ?? null}
      noticeError={notice?.error ?? false}
      onBack={() => router.back()}
      onFix={onFix}
      onLink={onLink}
      onMerge={onMerge}
      onRefresh={() => void pullRequests.refetch()}
      onRerun={onRerun}
      onUnlink={onUnlink}
      onUpdateBranch={onUpdateBranch}
      result={pullRequests.data ?? null}
    />
  );
}

function rerunNotice(pullRequest: PullRequest, results: PullRequestRerunResult[]): Notice {
  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    return {
      error: true,
      message: failures
        .map(
          (result) =>
            `Run ${result.runId}: ${result.error ?? "rerun failed"}${result.status ? ` (${result.status})` : ""}`,
        )
        .join("\n"),
    };
  }
  return {
    error: false,
    message:
      results.length > 0
        ? `Rerunning ${results.length} failed checks for PR #${pullRequest.number}.`
        : `No failed checks found for PR #${pullRequest.number}.`,
  };
}

function firstParam(value: string | string[] | undefined): string | null {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved?.trim() || null;
}
