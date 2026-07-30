import { VideoView, useVideoPlayer } from "expo-video";
import {
  ArrowLeft,
  FileText,
  Image as ImageIcon,
  Maximize2,
  Play,
  Route,
  Share2,
  X,
  ZoomIn,
} from "lucide-react-native";
import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
        {download.status === "ready" && download.uri ? (
          <Pressable
            accessibilityLabel="Share evidence"
            accessibilityRole="button"
            onPress={() => onShare(download.uri!)}
            style={[
              styles.shareButton,
              { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle },
            ]}
          >
            <Share2 color={colors.textPrimary} size={18} />
          </Pressable>
        ) : null}
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
          <>
            <ArtifactDetails artifact={artifact} />
            <ArtifactViewer
              artifact={artifact}
              onShare={onShare}
              text={download.text}
              uri={download.uri}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ArtifactDetails({ artifact }: { artifact: EvidenceArtifact }) {
  const { colors } = useAppTheme();
  const detail = artifactDetails(artifact.kind);
  const Icon = detail.icon;
  return (
    <View
      style={[
        styles.details,
        { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
      ]}
    >
      <View style={styles.detailHeading}>
        <View style={[styles.kindBadge, { backgroundColor: `${colors.accent}1A` }]}>
          <Icon color={colors.accent} size={18} />
        </View>
        <View style={styles.heading}>
          <Text style={[styles.kindLabel, { color: colors.textPrimary }]}>{detail.title}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{detail.description}</Text>
        </View>
      </View>
      <View style={[styles.pathRow, { borderTopColor: colors.borderSubtle }]}>
        <Text style={[styles.pathLabel, { color: colors.textMuted }]}>Artifact path</Text>
        <Text selectable numberOfLines={2} style={[styles.path, { color: colors.textSecondary }]}>
          {artifact.path}
        </Text>
      </View>
    </View>
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
    return <ZoomableEvidenceImage uri={uri} />;
  }
  if (artifact.kind === "video") return <EvidenceVideo uri={uri} />;
  if (artifact.kind === "report") {
    return (
      <View style={styles.reportWrap}>
        <Text style={[styles.viewerHint, { color: colors.textMuted }]}>
          Read-only report · selectable text
        </Text>
        <Text
          selectable
          style={[styles.report, { backgroundColor: colors.bgPanel, color: colors.textPrimary }]}
        >
          {text ?? "The report is cached, but could not be decoded as text."}
        </Text>
        <Pressable
          accessibilityLabel="Share report"
          accessibilityRole="button"
          onPress={() => onShare(uri)}
          style={[styles.secondaryAction, { borderColor: colors.borderStrong }]}
        >
          <Share2 color={colors.textPrimary} size={16} />
          <Text style={{ color: colors.textPrimary, fontWeight: "800" }}>Share report</Text>
        </Pressable>
      </View>
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
  const { colors } = useAppTheme();
  const player = useVideoPlayer(uri, (candidate) => {
    candidate.loop = true;
  });
  return (
    <View style={styles.videoWrap}>
      <Text style={[styles.viewerHint, { color: colors.textMuted }]}>
        Native controls · scrub, pause or view full screen
      </Text>
      <VideoView
        accessibilityLabel="Evidence video"
        contentFit="contain"
        nativeControls
        player={player}
        style={styles.video}
      />
    </View>
  );
}

function ZoomableEvidenceImage({ uri }: { uri: string }) {
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const nextZoom = () => setZoom((value) => (value >= 3 ? 1 : value + 1));
  return (
    <>
      <Pressable
        accessibilityLabel="Zoom evidence image"
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={[
          styles.imagePreview,
          { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
        ]}
      >
        <Image
          accessibilityLabel="Evidence image"
          resizeMode="contain"
          source={{ uri }}
          style={styles.image}
        />
        <View style={[styles.zoomHint, { backgroundColor: "#000000B8" }]}>
          <Maximize2 color="#FFFFFF" size={15} />
          <Text style={styles.zoomHintText}>Tap to inspect</Text>
        </View>
      </Pressable>
      <Modal animationType="fade" onRequestClose={() => setOpen(false)} visible={open}>
        <View style={styles.zoomModal}>
          <View style={styles.zoomToolbar}>
            <Text style={styles.zoomTitle}>Evidence image</Text>
            <Pressable
              accessibilityLabel="Close image preview"
              accessibilityRole="button"
              onPress={() => setOpen(false)}
              style={styles.zoomControl}
            >
              <X color="#FFFFFF" size={21} />
            </Pressable>
          </View>
          <Pressable
            accessibilityHint="Tap to cycle image zoom"
            accessibilityLabel={`Evidence image at ${zoom}x zoom`}
            accessibilityRole="button"
            onPress={nextZoom}
            style={styles.zoomStage}
          >
            <Image
              resizeMode="contain"
              source={{ uri }}
              style={[styles.zoomImage, { transform: [{ scale: zoom }] }]}
            />
          </Pressable>
          <View style={styles.zoomFooter}>
            <ZoomIn color="#FFFFFF" size={17} />
            <Text style={styles.zoomFooterText}>Tap image to zoom · {zoom}×</Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

function artifactDetails(kind: EvidenceArtifact["kind"]) {
  if (kind === "image")
    return {
      title: "Image evidence",
      description: "Open full screen and zoom for visual inspection.",
      icon: ImageIcon,
    };
  if (kind === "video")
    return {
      title: "Video evidence",
      description: "Play the original recording with native controls.",
      icon: Play,
    };
  if (kind === "trace")
    return {
      title: "Trace archive",
      description: "Share the archive and open it in Playwright Trace Viewer.",
      icon: Route,
    };
  return {
    title: "Report",
    description: "Read the detailed result or share the original file.",
    icon: FileText,
  };
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
  detailHeading: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  details: { borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  heading: { flex: 1 },
  image: { height: 480, width: "100%" },
  imagePreview: { borderRadius: radii.md, borderWidth: 1, overflow: "hidden" },
  kindBadge: {
    alignItems: "center",
    borderRadius: radii.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  kindLabel: { fontSize: 16, fontWeight: "800" },
  path: { fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
  pathLabel: { fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  pathRow: { borderTopWidth: StyleSheet.hairlineWidth, gap: 3, paddingTop: spacing.sm },
  report: {
    borderRadius: radii.md,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
    padding: spacing.md,
  },
  reportWrap: { gap: spacing.sm },
  safeArea: { flex: 1 },
  secondaryAction: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  shareButton: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  state: { borderRadius: radii.md, borderWidth: 1, gap: spacing.md, padding: spacing.md },
  subtitle: { fontSize: 12, marginTop: 2 },
  title: { fontSize: 18, fontWeight: "800" },
  trace: { borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  traceHelp: { fontSize: 13, lineHeight: 19 },
  tracePath: { fontFamily: "monospace", fontSize: 12 },
  traceTitle: { fontSize: 17, fontWeight: "800" },
  video: { backgroundColor: "#000000", borderRadius: radii.md, height: 420, width: "100%" },
  videoWrap: { gap: spacing.sm },
  viewerHint: { fontSize: 12, lineHeight: 17 },
  zoomControl: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  zoomFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    padding: spacing.md,
  },
  zoomFooterText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  zoomHint: {
    alignItems: "center",
    alignSelf: "flex-end",
    borderRadius: radii.pill,
    bottom: spacing.sm,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    position: "absolute",
    right: spacing.sm,
  },
  zoomHintText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  zoomImage: { height: "100%", width: "100%" },
  zoomModal: { backgroundColor: "#000000", flex: 1 },
  zoomStage: { alignItems: "center", flex: 1, justifyContent: "center", overflow: "hidden" },
  zoomTitle: { color: "#FFFFFF", flex: 1, fontSize: 16, fontWeight: "800" },
  zoomToolbar: { alignItems: "center", flexDirection: "row", padding: spacing.md },
});
