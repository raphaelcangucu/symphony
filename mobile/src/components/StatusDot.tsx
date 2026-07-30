import { StyleSheet, View } from "react-native";

import { useAppTheme } from "@/theme/ThemeProvider";

export type StatusTone = "success" | "warning" | "danger" | "accent" | "muted";

type StatusDotProps = {
  size?: number;
  tone: StatusTone;
};

export function StatusDot({ size = 8, tone }: StatusDotProps) {
  const { colors } = useAppTheme();
  const colorByTone: Record<StatusTone, string> = {
    success: colors.statusGreen,
    warning: colors.statusAmber,
    danger: colors.statusRed,
    accent: colors.statusPurple,
    muted: colors.textMuted,
  };

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.dot,
        { backgroundColor: colorByTone[tone], borderRadius: size / 2, height: size, width: size },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    flexShrink: 0,
  },
});
