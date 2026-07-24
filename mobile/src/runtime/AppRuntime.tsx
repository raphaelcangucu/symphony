import { createContext, useContext, type ReactNode } from "react";

import { createTrackerClient } from "@/api/client";
import type { ConnectionStorage } from "@/auth/connection-storage";
import { createAssistantSession } from "@/realtime/assistant-session";

export type AppRuntime = {
  connectionStorage?: ConnectionStorage;
  createTrackerClient: typeof createTrackerClient;
  createAssistantSession: typeof createAssistantSession;
};

export const productionRuntime: AppRuntime = {
  createTrackerClient,
  createAssistantSession,
};

const AppRuntimeContext = createContext<AppRuntime>(productionRuntime);

export function AppRuntimeProvider({
  children,
  runtime,
}: {
  children: ReactNode;
  runtime: AppRuntime;
}) {
  return <AppRuntimeContext.Provider value={runtime}>{children}</AppRuntimeContext.Provider>;
}

export function useAppRuntime(): AppRuntime {
  return useContext(AppRuntimeContext);
}
