import "react-native-reanimated";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider, useAppTheme } from "@/theme/ThemeProvider";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedStack />
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
