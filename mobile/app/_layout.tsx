import "react-native-reanimated";

import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { QueryProvider } from "@/api/QueryProvider";
import { TrackerClientProvider } from "@/api/TrackerClientProvider";
import { ConnectionProvider, useConnection } from "@/auth/ConnectionProvider";
import {
  activateNotificationDestination,
  type NotificationDestination,
} from "@/native/notifications";
import { RpcClientProvider } from "@/orca/transport/client-context";
import { HostStoreProvider } from "@/orca/transport/HostStoreProvider";
import { useViewMode, ViewModeProvider } from "@/preferences/ViewModeProvider";
import { AppRuntimeProvider, productionRuntime, useAppRuntime } from "@/runtime/AppRuntime";
import { HostRuntimeProvider } from "@/runtime/HostRuntimeProvider";
import { ThemeProvider, useAppTheme } from "@/theme/ThemeProvider";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ViewModeProvider>
          <AppRuntimeProvider runtime={productionRuntime}>
            <ConnectionProvider storage={productionRuntime.connectionStorage}>
              <HostStoreProvider>
                <HostRuntimeProvider>
                  <RpcClientProvider>
                    <TrackerClientProvider createClient={productionRuntime.createTrackerClient}>
                      <QueryProvider>
                        <ThemedStack />
                      </QueryProvider>
                    </TrackerClientProvider>
                  </RpcClientProvider>
                </HostRuntimeProvider>
              </HostStoreProvider>
            </ConnectionProvider>
          </AppRuntimeProvider>
        </ViewModeProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedStack() {
  const theme = useAppTheme();
  const router = useRouter();
  const { notifications } = useAppRuntime();
  const { hydrated, activeProfile, profiles, selectProfile } = useConnection();
  const { mode } = useViewMode();

  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    const openDestination = (destination: NotificationDestination) =>
      activateNotificationDestination({
        destination,
        profiles,
        selectProfile,
        mode,
        selectedHostId: activeProfile?.hostId ?? activeProfile?.id ?? null,
        openRoute: (route) => {
          if (active) router.push(route as never);
        },
      });
    void notifications.router.initialRoute().then((destination) => {
      if (active && destination) void openDestination(destination);
    });
    const subscription = notifications.router.subscribe((destination) => {
      void openDestination(destination);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [activeProfile, hydrated, mode, notifications, profiles, router, selectProfile]);

  return (
    <>
      <StatusBar style={theme.name === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: theme.colors.bgBase },
          headerShown: false,
        }}
      />
    </>
  );
}
