import { createContext, useContext, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { themes, type AppTheme, type ThemeName } from "@/theme/tokens";

const ThemeContext = createContext<AppTheme | null>(null);

type ThemeProviderProps = {
  children: ReactNode;
  colorScheme?: ThemeName;
};

export function ThemeProvider({ children, colorScheme }: ThemeProviderProps) {
  const systemColorScheme = useColorScheme();
  const resolvedColorScheme = colorScheme ?? (systemColorScheme === "light" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={themes[resolvedColorScheme]}>{children}</ThemeContext.Provider>
  );
}

export function useAppTheme(): AppTheme {
  const theme = useContext(ThemeContext);

  if (!theme) {
    throw new Error("useAppTheme must be used within ThemeProvider");
  }

  return theme;
}
