import "react-native-reanimated";

import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { QueryProvider } from "@/api/QueryProvider";
import { TrackerClientProvider } from "@/api/TrackerClientProvider";
import { ConnectionProvider, useConnection } from "@/auth/ConnectionProvider";
import {
  activateNotificationDestination,
  type NotificationDestination,
} from "@/native/notifications";
import { RpcClientProvider } from "@/dev10x/transport/client-context";
import { AnimatedSplash } from "@/dev10x/components/AnimatedSplash";
import { HostStoreProvider } from "@/dev10x/transport/HostStoreProvider";
import { AppRuntimeProvider, productionRuntime, useAppRuntime } from "@/runtime/AppRuntime";
import { HostRuntimeProvider } from "@/runtime/HostRuntimeProvider";
import { ThemeProvider, useAppTheme } from "@/theme/ThemeProvider";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider colorScheme="dark">
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
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedStack() {
  const theme = useAppTheme();
  const router = useRouter();
  const { notifications } = useAppRuntime();
  const { hydrated, activeProfile, profiles, selectProfile } = useConnection();
  const splashHideStarted = useRef(false);
  const [showAnimatedSplash, setShowAnimatedSplash] = useState(false);
  const [animatedSplashFinished, setAnimatedSplashFinished] = useState(false);

  const hideNativeSplash = useCallback(() => {
    if (splashHideStarted.current) return;
    splashHideStarted.current = true;
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setShowAnimatedSplash(true);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    const openDestination = (destination: NotificationDestination) =>
      activateNotificationDestination({
        destination,
        profiles,
        selectProfile,
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
  }, [activeProfile, hydrated, notifications, profiles, router, selectProfile]);

  return (
    <>
      <StatusBar style={theme.name === "dark" ? "light" : "dark"} />
      {(!showAnimatedSplash || animatedSplashFinished) && (
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: theme.colors.bgBase },
            headerShown: false,
          }}
        />
      )}
      {showAnimatedSplash && !animatedSplashFinished && (
        <AnimatedSplash
          onFinished={() => setAnimatedSplashFinished(true)}
          onReady={hideNativeSplash}
        />
      )}
    </>
  );
}
