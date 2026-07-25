import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import type { DevServer } from "@/api/contracts";
import { StateView } from "@/components/StateView";
import { spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type PreviewScreenProps = {
  server: DevServer | null;
  loading: boolean;
  error: string | null;
  onBack(): void;
  onStart(): void;
  onRestart(): void;
};

export function PreviewScreen({
  server,
  loading,
  error,
  onBack,
  onStart,
  onRestart,
}: PreviewScreenProps) {
  const { colors } = useAppTheme();
  const url = server?.publicUrl ?? server?.url ?? server?.localUrl ?? null;
  const crashed = server?.status === "crashed";
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <View style={[styles.header, { borderColor: colors.borderSubtle }]}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.headerAction}
        >
          <Text style={[styles.back, { color: colors.textPrimary }]}>‹</Text>
        </Pressable>
        <View style={styles.address}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Preview</Text>
          {url ? (
            <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 11 }}>
              {url}
            </Text>
          ) : null}
        </View>
        {server?.status === "ready" ? (
          <Pressable
            accessibilityLabel="Restart preview"
            accessibilityRole="button"
            onPress={onRestart}
            style={styles.headerAction}
          >
            <Text style={{ color: colors.accent }}>Restart</Text>
          </Pressable>
        ) : (
          <View style={styles.headerAction} />
        )}
      </View>
      {url && server?.status === "ready" ? (
        <WebView
          allowsBackForwardNavigationGestures
          source={{ uri: url }}
          startInLoadingState
          testID="workspace-preview"
        />
      ) : loading ? (
        <StateView kind="loading" title="Starting preview" />
      ) : (
        <StateView
          actionLabel={crashed ? "Restart preview" : "Start preview"}
          description={error ?? previewReason(server)}
          kind={error || crashed ? "error" : "empty"}
          onAction={crashed ? onRestart : onStart}
          title={crashed ? "Preview crashed" : "Preview is not running"}
        />
      )}
    </SafeAreaView>
  );
}

function previewReason(server: DevServer | null): string {
  if (!server) return "Start the workspace dev server to open it inside the app.";
  if (server.status === "starting" || server.status === "provisioning") {
    return "The workspace dev server is starting.";
  }
  return `Preview status: ${server.status}`;
}

const styles = StyleSheet.create({
  address: { alignItems: "center", flex: 1, paddingHorizontal: spacing.xs },
  back: { fontSize: 34, lineHeight: 36 },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  headerAction: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 64 },
  safeArea: { flex: 1 },
  title: { fontSize: 16, fontWeight: "700" },
});
