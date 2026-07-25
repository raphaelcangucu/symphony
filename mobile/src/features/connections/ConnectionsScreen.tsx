import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ConnectionProfile } from "@/auth/connection-profile";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

export type ConnectionHealth = "checking" | "live" | "offline";

type ConnectionsScreenProps = {
  profiles: ConnectionProfile[];
  activeProfileId: string | null;
  health: Record<string, ConnectionHealth>;
  busyProfileId: string | null;
  error: string | null;
  onAdd(): void;
  onBack(): void;
  onReconnect(profileId: string): void;
  onRemove(profileId: string): void;
  onReplaceToken(profileId: string, token: string): void;
  onSelect(profileId: string): void;
};

export function ConnectionsScreen({
  activeProfileId,
  busyProfileId,
  error,
  health,
  onAdd,
  onBack,
  onReconnect,
  onRemove,
  onReplaceToken,
  onSelect,
  profiles,
}: ConnectionsScreenProps) {
  const { colors } = useAppTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [token, setToken] = useState("");

  function saveToken(profile: ConnectionProfile) {
    const nextToken = token.trim();
    if (!nextToken) return;
    onReplaceToken(profile.id, nextToken);
    setToken("");
    setEditingId(null);
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <View style={styles.header}>
        <HeaderButton label="Back" onPress={onBack} text="‹" />
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>
          Connections
        </Text>
        <HeaderButton label="Add connection" onPress={onAdd} text="＋" />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.statusRed }]}>
          {error}
        </Text>
      ) : null}
      <ScrollView contentContainerStyle={styles.content}>
        {profiles.map((profile) => {
          const active = profile.id === activeProfileId;
          const state = health[profile.id] ?? "checking";
          const busy = busyProfileId === profile.id;
          return (
            <View
              key={profile.id}
              style={[
                styles.card,
                { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
              ]}
            >
              <View style={styles.row}>
                <View style={styles.grow}>
                  <Text style={[styles.name, { color: colors.textPrimary }]}>{profile.name}</Text>
                  <Text selectable style={{ color: colors.textMuted }}>
                    {profile.endpoint ?? profile.origin}
                  </Text>
                </View>
                <View style={styles.badges}>
                  {active ? (
                    <Text style={[styles.badge, { color: colors.accent }]}>Active</Text>
                  ) : null}
                  <Text style={[styles.badge, { color: colors.textMuted }]}>
                    {profile.transport === "rpc" ? "Encrypted RPC" : "Legacy"}
                  </Text>
                  <Text style={[styles.badge, { color: healthColor(state, colors) }]}>
                    {healthLabel(state)}
                  </Text>
                </View>
              </View>

              {editingId === profile.id ? (
                <View style={styles.editor}>
                  <TextInput
                    accessibilityLabel={`New token for ${profile.name}`}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setToken}
                    placeholder="New tracker token"
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.bgRaised,
                        borderColor: colors.borderStrong,
                        color: colors.textPrimary,
                      },
                    ]}
                    value={token}
                  />
                  <Action
                    disabled={busy || !token.trim()}
                    label={`Save token for ${profile.name}`}
                    onPress={() => saveToken(profile)}
                  />
                </View>
              ) : null}

              <View style={styles.actions}>
                {!active ? (
                  <Action
                    disabled={busy}
                    label={`Use ${profile.name}`}
                    onPress={() => onSelect(profile.id)}
                  />
                ) : null}
                <Action
                  disabled={busy}
                  label={`Reconnect ${profile.name}`}
                  onPress={() => onReconnect(profile.id)}
                />
                {profile.transport !== "rpc" ? (
                  <Action
                    disabled={busy}
                    label={`Replace token for ${profile.name}`}
                    onPress={() => {
                      setEditingId(profile.id);
                      setToken("");
                    }}
                  />
                ) : null}
                <Action
                  destructive
                  disabled={busy}
                  label={`Remove ${profile.name}`}
                  onPress={() => onRemove(profile.id)}
                />
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function HeaderButton({ label, onPress, text }: { label: string; onPress(): void; text: string }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.headerAction}
    >
      <Text style={[styles.headerIcon, { color: colors.textPrimary }]}>{text}</Text>
    </Pressable>
  );
}

function Action({
  destructive = false,
  disabled,
  label,
  onPress,
}: {
  destructive?: boolean;
  disabled: boolean;
  label: string;
  onPress(): void;
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
          backgroundColor: pressed ? colors.bgPressed : colors.bgRaised,
          borderColor: colors.borderStrong,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={{ color: destructive ? colors.statusRed : colors.textPrimary, fontWeight: "600" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function healthLabel(state: ConnectionHealth): string {
  if (state === "live") return "Live";
  if (state === "offline") return "Offline";
  return "Checking";
}

function healthColor(
  state: ConnectionHealth,
  colors: ReturnType<typeof useAppTheme>["colors"],
): string {
  if (state === "live") return colors.statusGreen;
  if (state === "offline") return colors.statusRed;
  return colors.statusAmber;
}

const styles = StyleSheet.create({
  action: {
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  badge: { fontSize: 12, fontWeight: "700" },
  badges: { alignItems: "flex-end", gap: spacing.xxs },
  card: { borderRadius: radii.md, borderWidth: 1, gap: spacing.md, padding: spacing.md },
  content: { gap: spacing.sm, padding: spacing.md },
  editor: { gap: spacing.xs },
  error: { marginHorizontal: spacing.md, marginTop: spacing.xs },
  grow: { flex: 1, gap: spacing.xxs },
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
  headerIcon: { fontSize: 32, lineHeight: 34 },
  input: {
    borderRadius: radii.sm,
    borderWidth: 1,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  name: { fontSize: 17, fontWeight: "700" },
  row: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  safeArea: { flex: 1 },
  title: { fontSize: 20, fontWeight: "700" },
});
