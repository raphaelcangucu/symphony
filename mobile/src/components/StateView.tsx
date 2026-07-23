import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type StateViewProps = {
  actionLabel?: string;
  description?: string;
  kind: "loading" | "empty" | "error";
  onAction?: () => void;
  title: string;
};

export function StateView({ actionLabel, description, kind, onAction, title }: StateViewProps) {
  const { colors } = useAppTheme();
  const isLoading = kind === "loading";

  return (
    <View
      accessible={kind !== "empty"}
      accessibilityRole={kind === "error" ? "alert" : isLoading ? "progressbar" : undefined}
      style={styles.container}
    >
      {isLoading ? <ActivityIndicator color={colors.accent} size="small" /> : null}
      <Text
        style={[styles.title, { color: kind === "error" ? colors.statusRed : colors.textPrimary }]}
      >
        {title}
      </Text>
      {description ? (
        <Text style={[styles.description, { color: colors.textMuted }]}>{description}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: colors.accent, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Text style={[styles.actionLabel, { color: colors.onAccent }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: radii.sm,
    justifyContent: "center",
    marginTop: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
  container: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
    padding: spacing.xl,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 320,
    textAlign: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
});
