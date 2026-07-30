import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { DiagnosticEntry } from "@/diagnostics/diagnostic-log";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type DiagnosticsScreenProps = {
  connectionState: "live" | "offline" | "reconnecting";
  entries: DiagnosticEntry[];
  onBack(): void;
  onClear(): void;
  onReconnect(): void;
};

export function DiagnosticsScreen({
  connectionState,
  entries,
  onBack,
  onClear,
  onReconnect,
}: DiagnosticsScreenProps) {
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
          Diagnostics
        </Text>
        <View style={styles.headerAction} />
      </View>

      <View style={styles.summary}>
        <View>
          <Text style={{ color: colors.textMuted }}>Connection</Text>
          <Text style={{ color: stateColor(connectionState, colors), fontWeight: "700" }}>
            {stateLabel(connectionState)}
          </Text>
        </View>
        <View style={styles.summaryActions}>
          <Action label="Reconnect" onPress={onReconnect} />
          <Action label="Clear diagnostics" onPress={onClear} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {entries.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>No diagnostic events yet.</Text>
        ) : (
          entries.map((entry) => (
            <View
              key={entry.id}
              style={[
                styles.entry,
                { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
              ]}
            >
              <View style={styles.entryHeader}>
                <Text style={[styles.event, { color: colors.textPrimary }]}>{entry.event}</Text>
                <Text style={{ color: colors.textMuted }}>{entry.scope}</Text>
              </View>
              <Text style={{ color: colors.textMuted }}>{entry.at}</Text>
              <Text selectable style={[styles.details, { color: colors.textSecondary }]}>
                {JSON.stringify(entry.details, null, 2)}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Action({ label, onPress }: { label: string; onPress(): void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.action,
        { backgroundColor: colors.bgRaised, borderColor: colors.borderStrong },
      ]}
    >
      <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function stateLabel(state: DiagnosticsScreenProps["connectionState"]): string {
  if (state === "live") return "Live";
  if (state === "reconnecting") return "Reconnecting";
  return "Offline";
}

function stateColor(
  state: DiagnosticsScreenProps["connectionState"],
  colors: ReturnType<typeof useAppTheme>["colors"],
): string {
  if (state === "live") return colors.statusGreen;
  if (state === "reconnecting") return colors.statusAmber;
  return colors.statusRed;
}

const styles = StyleSheet.create({
  action: {
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  back: { fontSize: 34, lineHeight: 36 },
  content: { gap: spacing.sm, padding: spacing.md },
  details: { fontFamily: "monospace", fontSize: 12 },
  entry: { borderRadius: radii.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  entryHeader: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  event: { flex: 1, fontWeight: "700" },
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
  summary: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  summaryActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  title: { fontSize: 20, fontWeight: "700" },
});
