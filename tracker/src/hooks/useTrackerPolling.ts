import { useFocusedInterval } from "@/hooks/useFocusedInterval";
import type { TrackerKind } from "@/types/project";

interface UseTrackerPollingArgs {
  kind: TrackerKind;
  refetch: () => void;
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 30_000;

export function useTrackerPolling({ kind, refetch, intervalMs = DEFAULT_INTERVAL_MS }: UseTrackerPollingArgs): void {
  useFocusedInterval(refetch, intervalMs, { enabled: kind !== "local" });
}
