import { createContext, useContext, type ReactNode } from "react";

import { createTrackerClient } from "@/api/client";
import type { ConnectionStorage } from "@/auth/connection-storage";
import { dictateWithExpo, expoNotificationService } from "@/native/expo-services";
import type { NativeNotificationService } from "@/native/notifications";
import { createAssistantSession } from "@/realtime/assistant-session";
import { createTerminalSession } from "@/realtime/terminal-session";

export type AppRuntime = {
  connectionStorage?: ConnectionStorage;
  createTrackerClient: typeof createTrackerClient;
  createAssistantSession: typeof createAssistantSession;
  createTerminalSession: typeof createTerminalSession;
  dictate: (lang: string) => Promise<string>;
  notifications: NativeNotificationService;
};

export const productionRuntime: AppRuntime = {
  createTrackerClient,
  createAssistantSession,
  createTerminalSession,
  dictate: dictateWithExpo,
  notifications: expoNotificationService,
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
