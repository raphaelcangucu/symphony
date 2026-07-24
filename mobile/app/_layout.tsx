import "react-native-reanimated";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { TrackerClientProvider } from "@/api/TrackerClientProvider";
import { ConnectionProvider } from "@/auth/ConnectionProvider";
import { ThemeProvider, useAppTheme } from "@/theme/ThemeProvider";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ConnectionProvider>
          <TrackerClientProvider>
            <ThemedStack />
          </TrackerClientProvider>
        </ConnectionProvider>
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
