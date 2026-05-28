import { useEffect } from "react";
import type { TrackerKind } from "@/types/project";

interface UseTrackerPollingArgs {
  kind: TrackerKind;
  refetch: () => void;
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 30_000;

export function useTrackerPolling({ kind, refetch, intervalMs = DEFAULT_INTERVAL_MS }: UseTrackerPollingArgs): void {
  useEffect(() => {
    if (kind === "local") return;

    const timer = setInterval(refetch, intervalMs);
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [kind, refetch, intervalMs]);
}
