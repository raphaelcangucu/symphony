import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing, typography } from "@/dev10x/theme/mobile-theme";

export type NotificationState = "inactive" | "registered" | "denied" | "unsupported" | "error";

type NotificationsScreenProps = {
  busy: boolean;
  lastRoute: string | null;
  message: string | null;
  state: NotificationState;
  onBack(): void;
  onDisable(): void;
  onEnable(): void;
  onOpenSettings(): void;
  onSendTest(): void;
};

export function NotificationsScreen({
  busy,
  lastRoute,
  message,
  onBack,
  onDisable,
  onEnable,
  onOpenSettings,
  onSendTest,
  state,
}: NotificationsScreenProps) {
  const insets = useSafeAreaInsets();
  const enabled = state === "registered";
  const blocked = state === "denied";
  const unsupported = state === "unsupported";
  const hint = blocked
    ? "Notifications are disabled in system settings."
    : unsupported
      ? "Push notifications require a physical device."
      : "Receive task, approval and session updates from the selected Symphony host.";

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable accessibilityLabel="Back" style={styles.backButton} onPress={onBack}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>Notifications</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Push Notifications</Text>
          <Switch
            accessibilityLabel="Push notifications"
            value={enabled}
            disabled={busy || blocked || unsupported}
            onValueChange={(value) => (value ? onEnable() : onDisable())}
            trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
            thumbColor={colors.textPrimary}
          />
        </View>
        <Text style={styles.hint}>{hint}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {blocked ? (
          <Action label="Open device settings" onPress={onOpenSettings} disabled={busy} />
        ) : null}
        {enabled ? (
          <Action label="Send test notification" onPress={onSendTest} disabled={busy} />
        ) : null}
      </View>

      {lastRoute ? (
        <Text style={styles.lastRoute} numberOfLines={1}>
          Last opened: {lastRoute}
        </Text>
      ) : null}
    </View>
  );
}

function Action({
  disabled,
  label,
  onPress,
}: {
  disabled: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.settingsButton,
        pressed && styles.settingsButtonPressed,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
    >
      <Text style={styles.settingsButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    padding: spacing.lg,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  heading: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
  },
  rowLabel: {
    flex: 1,
    fontSize: typography.bodySize,
    fontWeight: "500",
    color: colors.textPrimary,
  },
  hint: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    lineHeight: 18,
    paddingHorizontal: spacing.md + 2,
    paddingBottom: spacing.md,
  },
  message: {
    fontSize: typography.metaSize,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md + 2,
    paddingBottom: spacing.sm,
  },
  settingsButton: {
    alignSelf: "flex-start",
    marginHorizontal: spacing.md + 2,
    marginBottom: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.bgRaised,
  },
  settingsButtonPressed: {
    opacity: 0.6,
  },
  settingsButtonText: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.45,
  },
  lastRoute: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    marginTop: spacing.md,
  },
});
