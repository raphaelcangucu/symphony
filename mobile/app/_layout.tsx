import "react-native-reanimated";

import * as Linking from "expo-linking";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { QueryProvider } from "@/api/QueryProvider";
import { TrackerClientProvider } from "@/api/TrackerClientProvider";
import { ConnectionProvider } from "@/auth/ConnectionProvider";
import { createFixtureRuntime, fixtureModeFromUrl } from "@/e2e/fixture-runtime";
import { AppRuntimeProvider, productionRuntime } from "@/runtime/AppRuntime";
import { ThemeProvider, useAppTheme } from "@/theme/ThemeProvider";

export default function RootLayout() {
  const [initialUrl, setInitialUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void Linking.getInitialURL().then((url) => {
      if (active) setInitialUrl(url);
    });
    return () => {
      active = false;
    };
  }, []);
  const fixtureMode = fixtureModeFromUrl(process.env.EXPO_PUBLIC_E2E_FIXTURES, initialUrl ?? null);
  const runtime = useMemo(
    () => (fixtureMode ? createFixtureRuntime() : productionRuntime),
    [fixtureMode],
  );

  if (initialUrl === undefined) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppRuntimeProvider runtime={runtime}>
          <ConnectionProvider storage={runtime.connectionStorage}>
            <TrackerClientProvider createClient={runtime.createTrackerClient}>
              <QueryProvider>
                <ThemedStack />
              </QueryProvider>
            </TrackerClientProvider>
          </ConnectionProvider>
        </AppRuntimeProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedStack() {
  const theme = useAppTheme();

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
