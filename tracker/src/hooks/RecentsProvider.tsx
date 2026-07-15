import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { usePhoenixChannel } from "@/hooks/usePhoenixChannel";
import { listRecents } from "@/services/recents";
import { RECENTS_TOPIC, bindRecentsEvents } from "@/services/phoenix/recentsChannel";
import type { RecentSession } from "@/types/recents";

export interface RecentsContextValue {
  sessions: readonly RecentSession[];
  loading: boolean;
}

const RecentsContext = createContext<RecentsContextValue | null>(null);

export interface RecentsProviderProps {
  children: ReactNode;
}

export function RecentsProvider({ children }: RecentsProviderProps) {
  const [sessions, setSessions] = useState<readonly RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const fallbackStartedRef = useRef(false);

  const loadJoinFallback = useCallback(async () => {
    if (fallbackStartedRef.current) return;
    fallbackStartedRef.current = true;

    try {
      setSessions(await listRecents(100));
    } catch {
      // Keep the last channel snapshot when the one permitted fallback fails.
    } finally {
      setLoading(false);
    }
  }, []);

  usePhoenixChannel({
    topic: RECENTS_TOPIC,
    onSetup: (channel) =>
      bindRecentsEvents(channel, {
        onSnapshot: (items) => {
          setSessions(items);
          setLoading(false);
        },
      }),
    onJoinError: () => void loadJoinFallback(),
  });

  const value = useMemo<RecentsContextValue>(() => ({ sessions, loading }), [loading, sessions]);
  return <RecentsContext.Provider value={value}>{children}</RecentsContext.Provider>;
}

export function useRecentsContext(): RecentsContextValue {
  const value = useContext(RecentsContext);
  if (!value) {
    throw new Error("useRecents must be used within RecentsProvider");
  }
  return value;
}
