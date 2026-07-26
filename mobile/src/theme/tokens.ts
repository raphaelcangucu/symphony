export type ThemeColors = {
  bgBase: string;
  bgPanel: string;
  bgRaised: string;
  bgPressed: string;
  borderSubtle: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  statusGreen: string;
  statusAmber: string;
  statusRed: string;
  statusPurple: string;
};

export type ThemeName = "light" | "dark";

export type AppTheme = {
  name: ThemeName;
  colors: ThemeColors;
};

const lightColors: ThemeColors = {
  bgBase: "#f7f8fb",
  bgPanel: "#ffffff",
  bgRaised: "#ffffff",
  bgPressed: "#eef1f7",
  borderSubtle: "#e4e7ec",
  borderStrong: "#cbd1dc",
  textPrimary: "#111827",
  textSecondary: "#4b5563",
  textMuted: "#7c8492",
  accent: "#2563eb",
  accentSoft: "#e8efff",
  onAccent: "#ffffff",
  statusGreen: "#059669",
  statusAmber: "#d97706",
  statusRed: "#dc2626",
  statusPurple: "#7c3aed",
};

const darkColors: ThemeColors = {
  bgBase: "#111111",
  bgPanel: "#1a1a1a",
  bgRaised: "#242424",
  bgPressed: "#242424",
  borderSubtle: "#2a2a2a",
  borderStrong: "#3a3a3a",
  textPrimary: "#e0e0e0",
  textSecondary: "#888888",
  textMuted: "#555555",
  accent: "#3b82f6",
  accentSoft: "#1d2b45",
  onAccent: "#ffffff",
  statusGreen: "#22c55e",
  statusAmber: "#f59e0b",
  statusRed: "#ef4444",
  statusPurple: "#a78bfa",
};

export const themes: Record<ThemeName, AppTheme> = {
  light: { name: "light", colors: lightColors },
  dark: { name: "dark", colors: darkColors },
};

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;
