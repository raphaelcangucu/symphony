import { useQuery } from "@tanstack/react-query";

import type { HostTransport } from "@/transport/HostTransport";

import { listTaskEvidence } from "./rpc-evidence";

export function taskEvidenceQueryKey(hostId: string, projectSlug: string, identifier: string) {
  return ["host", hostId, "task-evidence", projectSlug, identifier] as const;
}

export function useTaskEvidence({
  transport,
  projectSlug,
  identifier,
}: {
  transport: HostTransport | null;
  projectSlug: string;
  identifier: string;
}) {
  const hostId = transport?.hostId ?? "unavailable";
  const query = useQuery({
    queryKey: taskEvidenceQueryKey(hostId, projectSlug, identifier),
    enabled: Boolean(transport && projectSlug && identifier),
    queryFn: ({ signal }) => listTaskEvidence(transport!, projectSlug, identifier, signal),
    refetchInterval: transport ? 5_000 : false,
  });

  return {
    records: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: query.refetch,
    cached: !transport && Boolean(query.data),
  };
}
