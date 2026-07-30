import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useConnection } from "@/auth/ConnectionProvider";

import {
  profileQueryCacheKey,
  removeProfileQueries,
  restoreProfileQueries,
  saveProfileQueries,
} from "./query-cache";

export function QueryProvider({ children }: { children: ReactNode }) {
  const { activeProfile, profiles } = useConnection();
  const previousProfileIds = useRef(new Set<string>());
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    const nextIds = new Set(profiles.map((profile) => profile.hostId ?? profile.id));
    for (const previousId of previousProfileIds.current) {
      if (!nextIds.has(previousId)) {
        removeProfileQueries(client, previousId);
        void AsyncStorage.removeItem(profileQueryCacheKey(previousId));
      }
    }
    previousProfileIds.current = nextIds;
  }, [client, profiles]);

  useEffect(() => {
    const profileId = activeProfile?.hostId ?? activeProfile?.id;
    if (!profileId) return;
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void restoreProfileQueries(client, profileId, AsyncStorage).then(() => {
      if (!active) return;
      unsubscribe = client.getQueryCache().subscribe(() => {
        void saveProfileQueries(client, profileId, AsyncStorage);
      });
    });
    return () => {
      active = false;
      unsubscribe();
      void saveProfileQueries(client, profileId, AsyncStorage);
    };
  }, [activeProfile?.hostId, activeProfile?.id, client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
