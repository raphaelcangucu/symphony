import { useQuery } from "@tanstack/react-query";

import { useTrackerClient } from "@/api/TrackerClientProvider";
import { useConnection } from "@/auth/ConnectionProvider";

import {
  sourceChangeSummary,
  type SourceChangeSummary,
} from "./source-change-summary";

export function useThreadSourceChanges(
  threadId: number | null,
): SourceChangeSummary | null {
  const client = useTrackerClient();
  const { activeProfile } = useConnection();
  const hostId = activeProfile?.hostId ?? activeProfile?.id ?? null;
  const query = useQuery({
    queryKey: ["host", hostId, "thread-diff-stats", threadId, "uncommitted"],
    enabled: Boolean(client && threadId),
    queryFn: ({ signal }) => client!.threadDiffStats(threadId!, "uncommitted", signal),
    staleTime: 5_000,
  });
  return sourceChangeSummary(query.data);
}
