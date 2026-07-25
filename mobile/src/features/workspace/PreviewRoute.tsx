import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";

import { PreviewScreen } from "./PreviewScreen";

export function PreviewRoute() {
  const params = useLocalSearchParams<{ threadId?: string | string[] }>();
  const router = useRouter();
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const queryClient = useQueryClient();
  const threadId = parseThreadId(firstParam(params.threadId));
  const queryKey = ["thread-preview", activeProfile?.id, threadId] as const;
  const preview = useQuery({
    queryKey,
    enabled: Boolean(client && threadId),
    queryFn: ({ signal }) => client!.threadDevServers(threadId!, signal),
    refetchInterval: (query) =>
      query.state.data?.servers.some((server) =>
        ["pending", "provisioning", "starting"].includes(server.status),
      )
        ? 2_000
        : false,
  });
  const start = useMutation({
    mutationFn: () => client!.startThreadDevServers(threadId!),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });
  const restart = useMutation({
    mutationFn: () => client!.restartThreadDevServers(threadId!),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });
  if (!threadId) return null;
  const servers = preview.data?.servers ?? [];
  const server =
    servers.find((item) => item.primary && item.status === "ready") ??
    servers.find((item) => item.primary) ??
    servers[0] ??
    null;
  const error = preview.error ?? start.error ?? restart.error;
  return (
    <PreviewScreen
      error={
        error instanceof Error
          ? error.message
          : preview.data?.available === false
            ? preview.data.reason
            : null
      }
      loading={preview.isLoading || start.isPending || restart.isPending}
      onBack={() => router.back()}
      onRestart={() => restart.mutate()}
      onStart={() => start.mutate()}
      server={server}
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
