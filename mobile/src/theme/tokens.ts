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
  bgBase: "#080d1a",
  bgPanel: "#0d1424",
  bgRaised: "#121b2d",
  bgPressed: "#1a263d",
  borderSubtle: "#1d293d",
  borderStrong: "#334155",
  textPrimary: "#f8fafc",
  textSecondary: "#cbd5e1",
  textMuted: "#8d9aae",
  accent: "#60a5fa",
  accentSoft: "#172c4f",
  onAccent: "#07111f",
  statusGreen: "#34d399",
  statusAmber: "#fbbf24",
  statusRed: "#fb7185",
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
