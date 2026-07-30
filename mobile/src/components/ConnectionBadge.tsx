import { StyleSheet, Text, View } from "react-native";

import { StatusDot, type StatusTone } from "@/components/StatusDot";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

export type ConnectionState = "live" | "connecting" | "cached" | "offline" | "complete" | "failed";

const connectionPresentation: Record<ConnectionState, { label: string; tone: StatusTone }> = {
  live: { label: "Live", tone: "success" },
  connecting: { label: "Connecting", tone: "warning" },
  cached: { label: "Cached", tone: "accent" },
  offline: { label: "Offline", tone: "danger" },
  complete: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

type ConnectionBadgeProps = {
  state: ConnectionState;
};

export function ConnectionBadge({ state }: ConnectionBadgeProps) {
  const { colors } = useAppTheme();
  const presentation = connectionPresentation[state];

  return (
    <View
      accessibilityLabel={`Connection status: ${presentation.label}`}
      accessibilityRole="text"
      style={[styles.badge, { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle }]}
    >
      <StatusDot tone={presentation.tone} />
      <Text style={[styles.label, { color: colors.textSecondary }]}>{presentation.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.sm,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
});
