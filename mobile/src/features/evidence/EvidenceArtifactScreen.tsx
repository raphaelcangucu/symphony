import { VideoView, useVideoPlayer } from "expo-video";
import { ArrowLeft } from "lucide-react-native";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import type { EvidenceArtifact } from "./evidence-contract";

export type EvidenceArtifactDownload = {
  status: "idle" | "loading" | "ready" | "error";
  uri: string | null;
  text: string | null;
  error: string | null;
  cached: boolean;
};

export function EvidenceArtifactScreen({
  artifact,
  download,
  onBack,
  onRetry,
  onShare,
}: {
  artifact: EvidenceArtifact;
  download: EvidenceArtifactDownload;
  onBack(): void;
  onRetry(): void;
  onShare(uri: string): void;
}) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <View style={[styles.header, { borderColor: colors.borderSubtle }]}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.back}
        >
          <ArrowLeft color={colors.textPrimary} size={22} />
        </Pressable>
        <View style={styles.heading}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>
            {artifact.label}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Durable {artifact.kind} · encrypted RPC
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {download.cached ? (
          <Text style={[styles.cached, { color: colors.statusAmber }]}>
            Offline · cached on this device
          </Text>
        ) : null}
        {download.status === "loading" || download.status === "idle" ? (
          <View style={[styles.state, { borderColor: colors.borderSubtle }]}>
            <Text style={{ color: colors.textSecondary }}>Downloading encrypted evidence…</Text>
          </View>
        ) : null}
        {download.status === "error" ? (
          <View style={[styles.state, { borderColor: colors.statusRed }]}>
            <Text style={{ color: colors.statusRed }}>
              {download.error ?? "Unable to download evidence"}
            </Text>
            <Pressable
              accessibilityLabel="Retry evidence download"
              accessibilityRole="button"
              onPress={onRetry}
              style={[styles.action, { backgroundColor: colors.accent }]}
            >
              <Text style={{ color: colors.onAccent, fontWeight: "800" }}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {download.status === "ready" && download.uri ? (
          <ArtifactViewer
            artifact={artifact}
            onShare={onShare}
            text={download.text}
            uri={download.uri}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ArtifactViewer({
  artifact,
  uri,
  text,
  onShare,
}: {
  artifact: EvidenceArtifact;
  uri: string;
  text: string | null;
  onShare(uri: string): void;
}) {
  const { colors } = useAppTheme();
  if (artifact.kind === "image") {
    return (
      <Image
        accessibilityLabel="Evidence image"
        resizeMode="contain"
        source={{ uri }}
        style={[styles.image, { backgroundColor: colors.bgPanel }]}
      />
    );
  }
  if (artifact.kind === "video") return <EvidenceVideo uri={uri} />;
  if (artifact.kind === "report") {
    return (
      <Text
        selectable
        style={[styles.report, { backgroundColor: colors.bgPanel, color: colors.textPrimary }]}
      >
        {text ?? "The report is cached, but could not be decoded as text."}
      </Text>
    );
  }
  return (
    <View
      style={[styles.trace, { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle }]}
    >
      <Text style={[styles.traceTitle, { color: colors.textPrimary }]}>
        Playwright trace archive
      </Text>
      <Text selectable style={[styles.tracePath, { color: colors.textMuted }]}>
        {artifact.path}
      </Text>
      <Text style={[styles.traceHelp, { color: colors.textSecondary }]}>
        Share or save this ZIP and open it with Playwright Trace Viewer. Trace contents are never
        injected into a WebView.
      </Text>
      <Pressable
        accessibilityLabel="Share trace"
        accessibilityRole="button"
        onPress={() => onShare(uri)}
        style={[styles.action, { backgroundColor: colors.accent }]}
      >
        <Text style={{ color: colors.onAccent, fontWeight: "800" }}>Share trace</Text>
      </Pressable>
    </View>
  );
}

function EvidenceVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (candidate) => {
    candidate.loop = true;
  });
  return (
    <VideoView
      accessibilityLabel="Evidence video"
      contentFit="contain"
      nativeControls
      player={player}
      style={styles.video}
    />
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radii.sm,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  back: { alignItems: "center", height: 42, justifyContent: "center", width: 42 },
  cached: { fontSize: 13, fontWeight: "800" },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    paddingHorizontal: spacing.md,
  },
  heading: { flex: 1 },
  image: { borderRadius: radii.md, height: 560, width: "100%" },
  report: {
    borderRadius: radii.md,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
    padding: spacing.md,
  },
  safeArea: { flex: 1 },
  state: { borderRadius: radii.md, borderWidth: 1, gap: spacing.md, padding: spacing.md },
  subtitle: { fontSize: 12, marginTop: 2 },
  title: { fontSize: 18, fontWeight: "800" },
  trace: { borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  traceHelp: { fontSize: 13, lineHeight: 19 },
  tracePath: { fontFamily: "monospace", fontSize: 12 },
  traceTitle: { fontSize: 17, fontWeight: "800" },
  video: { backgroundColor: "#000000", borderRadius: radii.md, height: 420, width: "100%" },
});
