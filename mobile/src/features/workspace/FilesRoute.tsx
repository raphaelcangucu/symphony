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
    queryKey: ["thread-documents", activeProfile?.id, threadId],
    enabled: Boolean(client && threadId),
    queryFn: ({ signal }) => client!.threadDocuments(threadId!, signal),
  });
  useEffect(() => {
    if (!selectedPath && list.data?.documents[0]) {
      setSelectedPath(list.data.documents[0].path);
    }
  }, [list.data?.documents, selectedPath]);
  const document = useQuery({
    queryKey: ["thread-document", activeProfile?.id, threadId, selectedPath],
    enabled: Boolean(client && threadId && selectedPath),
    queryFn: ({ signal }) => client!.threadDocument(threadId!, selectedPath!, signal),
  });
  if (!threadId) return null;
  const queryError = list.error ?? document.error;
  return (
    <FilesScreen
      content={document.data?.content ?? null}
      documents={list.data?.documents ?? []}
      error={queryError instanceof Error ? queryError.message : (list.data?.reason ?? null)}
      loading={list.isLoading || document.isFetching}
      onBack={() => router.back()}
      onOpenDocument={setSelectedPath}
      onRefresh={() => void list.refetch()}
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
