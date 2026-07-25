import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";

import { FilesScreen } from "./FilesScreen";

export function FilesRoute() {
  const params = useLocalSearchParams<{ threadId?: string | string[] }>();
  const router = useRouter();
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const threadId = parseThreadId(firstParam(params.threadId));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["thread-files", activeProfile?.id, threadId],
    enabled: Boolean(client && threadId),
    queryFn: ({ signal }) => client!.threadFiles(threadId!, signal),
  });
  useEffect(() => {
    if (!selectedPath && list.data?.files[0]) {
      setSelectedPath(list.data.files[0].path);
    }
  }, [list.data?.files, selectedPath]);
  const file = useQuery({
    queryKey: ["thread-file", activeProfile?.id, threadId, selectedPath],
    enabled: Boolean(client && threadId && selectedPath),
    queryFn: ({ signal }) => client!.threadFile(threadId!, selectedPath!, signal),
  });
  if (!threadId) return null;
  const queryError = list.error ?? file.error;
  return (
    <FilesScreen
      files={list.data?.files ?? []}
      error={queryError instanceof Error ? queryError.message : (list.data?.reason ?? null)}
      loading={list.isLoading || file.isFetching}
      onBack={() => router.back()}
      onOpenDocument={setSelectedPath}
      onRefresh={() => void list.refetch()}
      preview={file.data ?? null}
      selectedPath={selectedPath}
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
