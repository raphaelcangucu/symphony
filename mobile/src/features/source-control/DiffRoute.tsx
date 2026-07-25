import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";

import type { GitDiffFileEntry } from "@/api/contracts";
import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";

import { DiffScreen } from "./DiffScreen";

type ActionNotice = {
  error: boolean;
  message: string;
};

export function DiffRoute() {
  const params = useLocalSearchParams<{ threadId?: string | string[] }>();
  const router = useRouter();
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const queryClient = useQueryClient();
  const threadId = parseThreadId(firstParam(params.threadId));
  const [selectedFile, setSelectedFile] = useState<GitDiffFileEntry | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const statsKey = ["thread-diff-stats", activeProfile?.id, threadId, "uncommitted"] as const;
  const filesKey = ["thread-diff-files", activeProfile?.id, threadId, "uncommitted"] as const;

  const stats = useQuery({
    queryKey: statsKey,
    enabled: Boolean(client && threadId),
    queryFn: ({ signal }) => client!.threadDiffStats(threadId!, "uncommitted", signal),
  });
  const files = useInfiniteQuery({
    queryKey: filesKey,
    enabled: Boolean(client && threadId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      client!.threadDiffFiles(
        threadId!,
        {
          type: "uncommitted",
          limit: 50,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const patch = useQuery({
    queryKey: [
      "thread-diff-patch",
      activeProfile?.id,
      threadId,
      "uncommitted",
      selectedFile?.repo,
      selectedFile?.path,
    ],
    enabled: Boolean(client && threadId && selectedFile && !selectedFile.binary),
    queryFn: ({ signal }) =>
      client!.threadDiffPatch(
        threadId!,
        {
          type: "uncommitted",
          repo: selectedFile!.repo,
          path: selectedFile!.path,
        },
        signal,
      ),
  });
  const refreshDiff = async () => {
    setSelectedFile(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: statsKey }),
      queryClient.invalidateQueries({ queryKey: filesKey }),
    ]);
  };
  const commit = useMutation({
    mutationFn: (message: string) => client!.commitThreadDiff(threadId!, message),
    onSuccess: async (result) => {
      setNotice({
        error: false,
        message:
          result.commits.length === 1
            ? `Committed ${result.commits[0]!.sha.slice(0, 7)}.`
            : `Created ${result.commits.length} commits.`,
      });
      await refreshDiff();
    },
  });
  const push = useMutation({
    mutationFn: () => client!.pushThreadDiff(threadId!),
    onSuccess: async (result) => {
      const failures = result.results.filter((item) => !item.ok);
      setNotice(
        failures.length > 0
          ? {
              error: true,
              message: failures
                .map((item) => `${item.repo}: ${item.error ?? "push failed"}`)
                .join("\n"),
            }
          : {
              error: false,
              message:
                result.results.length > 0
                  ? `Pushed ${result.results.length} repositories.`
                  : "No ahead branches to push.",
            },
      );
      await queryClient.invalidateQueries({ queryKey: statsKey });
    },
  });
  const rows = useMemo(
    () => files.data?.pages.flatMap((page) => page.files) ?? [],
    [files.data?.pages],
  );
  if (!threadId) return null;
  const requestError = stats.error ?? files.error ?? patch.error ?? commit.error ?? push.error;

  return (
    <DiffScreen
      actionError={notice?.error ?? false}
      actionMessage={notice?.message ?? null}
      busy={commit.isPending || push.isPending}
      error={requestError instanceof Error ? requestError.message : null}
      files={rows}
      hasMore={files.hasNextPage}
      loading={stats.isLoading || files.isLoading || patch.isFetching || files.isFetchingNextPage}
      onBack={() => router.back()}
      onCommit={(message) => commit.mutate(message)}
      onLoadMore={() => void files.fetchNextPage()}
      onOpenFile={setSelectedFile}
      onPush={() => push.mutate()}
      onRefresh={() => void refreshDiff()}
      patch={patch.data ?? null}
      selectedFile={selectedFile}
      stats={stats.data?.stats ?? []}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function parseThreadId(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
