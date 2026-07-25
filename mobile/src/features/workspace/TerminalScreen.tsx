import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConnectionBadge } from "@/components/ConnectionBadge";
import type { TerminalConnectionState } from "@/realtime/terminal-session";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type TerminalScreenProps = {
  threadId: number;
  output: string;
  connectionState: TerminalConnectionState;
  error: string | null;
  onBack(): void;
  onInput(data: string): void;
  onReconnect(): void;
};

export function TerminalScreen({
  threadId,
  output,
  connectionState,
  error,
  onBack,
  onInput,
  onReconnect,
}: TerminalScreenProps) {
  const { colors } = useAppTheme();
  const [command, setCommand] = useState("");
  const run = () => {
    const value = command.trim();
    if (!value) return;
    onInput(`${value}\n`);
    setCommand("");
  };
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
        ]}
      >
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.headerAction}
        >
          <Text style={[styles.back, { color: colors.textPrimary }]}>‹</Text>
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Terminal · {threadId}</Text>
          <ConnectionBadge state={connectionState} />
        </View>
        {connectionState === "offline" ? (
          <Pressable
            accessibilityLabel="Reconnect terminal"
            accessibilityRole="button"
            onPress={onReconnect}
            style={styles.headerAction}
          >
            <Text style={{ color: colors.accent }}>Retry</Text>
          </Pressable>
        ) : (
          <View style={styles.headerAction} />
        )}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.statusRed }]}>
          {error}
        </Text>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.outputContent}
        style={[styles.output, { backgroundColor: "#020617" }]}
      >
        <Text selectable style={styles.outputText}>
          {output || "Connecting to workspace terminal…"}
        </Text>
      </ScrollView>
      <View style={styles.controls}>
        <Pressable
          accessibilityLabel="Send Control C"
          accessibilityRole="button"
          onPress={() => onInput("\u0003")}
          style={[
            styles.controlButton,
            { backgroundColor: colors.bgRaised, borderColor: colors.borderStrong },
          ]}
        >
          <Text style={{ color: colors.textPrimary }}>Ctrl+C</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="Terminal command"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setCommand}
          onSubmitEditing={run}
          placeholder="Command"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            {
              backgroundColor: colors.bgPanel,
              borderColor: colors.borderStrong,
              color: colors.textPrimary,
            },
          ]}
          value={command}
        />
        <Pressable
          accessibilityLabel="Run command"
          accessibilityRole="button"
          disabled={!command.trim()}
          onPress={run}
          style={[
            styles.run,
            { backgroundColor: command.trim() ? colors.textPrimary : colors.bgPressed },
          ]}
        >
          <Text style={{ color: command.trim() ? colors.bgBase : colors.textMuted }}>Run</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  back: { fontSize: 34, lineHeight: 36 },
  controlButton: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  controls: { flexDirection: "row", gap: spacing.xs, padding: spacing.sm },
  error: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  headerAction: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 52,
  },
  input: {
    borderRadius: radii.sm,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  output: { flex: 1 },
  outputContent: { flexGrow: 1, justifyContent: "flex-end", padding: spacing.md },
  outputText: {
    color: "#e2e8f0",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 13,
    lineHeight: 19,
  },
  run: {
    alignItems: "center",
    borderRadius: radii.sm,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  safeArea: { flex: 1 },
  title: { fontSize: 15, fontWeight: "700" },
  titleBlock: { alignItems: "center", flex: 1, gap: spacing.xxs },
});
