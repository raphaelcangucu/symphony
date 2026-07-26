import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { AgentAvailabilityMap, AgentUsageMap } from "@/api/contracts";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type SettingsScreenProps = {
  availability: AgentAvailabilityMap;
  usage: AgentUsageMap;
  loading: boolean;
  error: string | null;
  onBack(): void;
  onOpenDiagnostics(): void;
  onOpenNotifications(): void;
  onRefresh(): void;
};

export function SettingsScreen({
  availability,
  error,
  loading,
  onBack,
  onOpenDiagnostics,
  onOpenNotifications,
  onRefresh,
  usage,
}: SettingsScreenProps) {
  const { colors } = useAppTheme();
  const agents = [...new Set([...Object.keys(availability), ...Object.keys(usage)])];

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
          Settings
        </Text>
        <View style={styles.headerAction} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="General">
          <SettingRow label="Appearance" value="System appearance" />
          <NavigationRow label="Notifications" onPress={onOpenNotifications} />
          <NavigationRow label="Diagnostics" onPress={onOpenDiagnostics} />
        </Section>

        <Section title="Agents and usage">
          {loading && agents.length === 0 ? (
            <Text style={{ color: colors.textMuted }}>Loading agent status…</Text>
          ) : error && agents.length === 0 ? (
            <>
              <Text accessibilityRole="alert" style={{ color: colors.statusAmber }}>
                {error}
              </Text>
              <NavigationRow
                accessibilityLabel="Retry settings"
                label="Retry"
                onPress={onRefresh}
              />
            </>
          ) : (
            agents.map((agent) => (
              <AgentRow
                agent={agent}
                availability={availability[agent]}
                key={agent}
                usage={usage[agent]}
              />
            ))
          )}
          {error && agents.length > 0 ? (
            <Text accessibilityRole="alert" style={{ color: colors.statusAmber }}>
              Showing cached status · {error}
            </Text>
          ) : null}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
      <View
        style={[styles.card, { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle }]}
      >
        {children}
      </View>
    </View>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.row}>
      <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{label}</Text>
      <Text style={{ color: colors.textMuted }}>{value}</Text>
    </View>
  );
}

function NavigationRow({
  accessibilityLabel,
  label,
  onPress,
}: {
  accessibilityLabel?: string;
  label: string;
  onPress(): void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? `Open ${label.toLowerCase()}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
    >
      <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{label}</Text>
      <Text style={{ color: colors.textMuted }}>›</Text>
    </Pressable>
  );
}

function AgentRow({
  agent,
  availability,
  usage,
}: {
  agent: string;
  availability: AgentAvailabilityMap[string] | undefined;
  usage: AgentUsageMap[string] | undefined;
}) {
  const { colors } = useAppTheme();
  const label = agent.charAt(0).toUpperCase() + agent.slice(1);
  return (
    <View style={styles.agent}>
      <View style={styles.row}>
        <Text style={[styles.agentName, { color: colors.textPrimary }]}>{label}</Text>
        <Text
          style={{
            color: availability?.available ? colors.statusGreen : colors.textMuted,
          }}
        >
          {availability?.available
            ? `Available${availability.version ? ` · ${availability.version}` : ""}`
            : "Unavailable"}
        </Text>
      </View>
      {usage?.windows.map((window) => (
        <View key={`${agent}:${window.kind}`} style={styles.usage}>
          <Text style={{ color: colors.textSecondary }}>{usageLabel(window.kind)}</Text>
          <Text style={{ color: window.usedPercent >= 90 ? colors.statusRed : colors.textPrimary }}>
            {Math.round(window.usedPercent)}% used
          </Text>
        </View>
      ))}
      {usage === null ? (
        <Text style={{ color: colors.textMuted }}>Usage has not been reported yet.</Text>
      ) : null}
    </View>
  );
}

function usageLabel(kind: string): string {
  return kind.replace(/^model:/, "").replaceAll("_", " ");
}

const styles = StyleSheet.create({
  agent: { gap: spacing.xs, paddingVertical: spacing.xs },
  agentName: { fontSize: 16, fontWeight: "700" },
  back: { fontSize: 34, lineHeight: 36 },
  card: { borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  content: { gap: spacing.lg, padding: spacing.md },
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
  row: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
    gap: spacing.sm,
  },
  safeArea: { flex: 1 },
  section: { gap: spacing.xs },
  sectionTitle: { fontSize: 13, fontWeight: "700", textTransform: "uppercase" },
  title: { fontSize: 20, fontWeight: "700" },
  usage: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
});
