import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { useConnection } from "@/auth/ConnectionProvider";

import { loadHosts } from "./host-store";
import type { HostProfile } from "./types";

export function usePersistedHosts(): {
  hosts: HostProfile[];
  refreshHosts(): Promise<HostProfile[]>;
} {
  const { hydrated, profiles } = useConnection();
  const [hosts, setHosts] = useState<HostProfile[]>([]);

  const refreshHosts = useCallback(async () => {
    if (!hydrated) return [];

    const nextHosts = await loadHosts();
    setHosts(nextHosts);
    return nextHosts;
  }, [hydrated, profiles]);

  useFocusEffect(
    useCallback(() => {
      if (!hydrated) return;

      let stale = false;
      void loadHosts().then((nextHosts) => {
        if (!stale) setHosts(nextHosts);
      });
      return () => {
        stale = true;
      };
    }, [hydrated, profiles]),
  );

  return { hosts, refreshHosts };
}
