import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useConnection } from "@/auth/ConnectionProvider";

import { createTrackerClient } from "./client";
import type { TrackerClient } from "./contracts";

type TrackerClientProviderProps = {
  children: ReactNode;
  createClient?: typeof createTrackerClient;
  locale?: string;
};

const TrackerClientContext = createContext<TrackerClient | null>(null);

export function TrackerClientProvider({
  children,
  createClient = createTrackerClient,
  locale = resolvedLocale(),
}: TrackerClientProviderProps) {
  const { activeProfile, activeToken } = useConnection();
  const client = useMemo(
    () =>
      activeProfile && activeToken
        ? createClient({
            origin: activeProfile.origin,
            token: activeToken,
            locale,
          })
        : null,
    [activeProfile, activeToken, createClient, locale],
  );

  return <TrackerClientContext.Provider value={client}>{children}</TrackerClientContext.Provider>;
}

export function useTrackerClient(): TrackerClient | null {
  return useContext(TrackerClientContext);
}

function resolvedLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}
