import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

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

const stateLabels: Record<NotificationState, string> = {
  denied: "Permission denied",
  error: "Needs attention",
  inactive: "Not registered",
  registered: "Registered",
  unsupported: "Unavailable on this device",
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
  const { colors } = useAppTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.headerAction}
        >
          <Text style={[styles.back, { color: colors.textPrimary }]}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>
          Notifications
        </Text>
        <View style={styles.headerAction} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
            Device notifications
          </Text>
          <Text style={[styles.status, { color: stateColor(state, colors) }]}>
            {stateLabels[state]}
          </Text>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            Receive actionable task and session updates for this connection.
          </Text>
          {message ? <Text style={{ color: colors.textSecondary }}>{message}</Text> : null}

          <Action disabled={busy} label="Enable notifications" onPress={onEnable} primary />
          {state === "registered" ? (
            <>
              <Action disabled={busy} label="Send test notification" onPress={onSendTest} />
              <Action disabled={busy} label="Disable notifications" onPress={onDisable} />
            </>
          ) : null}
          {state === "denied" ? (
            <Action disabled={busy} label="Open device settings" onPress={onOpenSettings} />
          ) : null}
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Last opened link</Text>
          <Text selectable style={{ color: colors.textSecondary }}>
            {lastRoute ?? "No notification opened yet"}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Action({
  disabled,
  label,
  onPress,
  primary = false,
}: {
  disabled: boolean;
  label: string;
  onPress(): void;
  primary?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: primary ? colors.accent : pressed ? colors.bgPressed : colors.bgRaised,
          borderColor: primary ? colors.accent : colors.borderStrong,
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      <Text style={{ color: primary ? colors.bgBase : colors.textPrimary, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function stateColor(
  state: NotificationState,
  colors: ReturnType<typeof useAppTheme>["colors"],
): string {
  if (state === "registered") return colors.statusGreen;
  if (state === "denied" || state === "error") return colors.statusAmber;
  return colors.textMuted;
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  back: { fontSize: 34, lineHeight: 36 },
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardTitle: { fontSize: 17, fontWeight: "700" },
  content: { gap: spacing.md, padding: spacing.md },
  description: { lineHeight: 20 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  headerAction: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
  },
  safeArea: { flex: 1 },
  status: { fontSize: 14, fontWeight: "700" },
  title: { fontSize: 20, fontWeight: "700" },
});
