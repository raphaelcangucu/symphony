import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type SectionHeaderProps = {
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  subtitle?: string;
  title: string;
};

export function SectionHeader({
  action,
  actionLabel,
  onAction,
  subtitle,
  title,
}: SectionHeaderProps) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      {action && onAction ? (
        <Pressable
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onAction}
          style={styles.action}
        >
          {action}
        </Pressable>
      ) : (
        action
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
  },
  copy: {
    flex: 1,
    gap: spacing.xxs,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: 52,
  },
  subtitle: {
    fontSize: 13,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
});
