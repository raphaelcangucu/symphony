import { useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { GitDiffFileEntry, GitDiffPatchResult, GitDiffRepoStat } from "@/api/contracts";
import { StateView } from "@/components/StateView";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import { CommitSheet } from "./CommitSheet";
import { groupDiffFiles, parsePatchLines, type PatchLineKind } from "./diff-state";

type DiffScreenProps = {
  actionError: boolean;
  actionMessage: string | null;
  busy: boolean;
  error: string | null;
  files: GitDiffFileEntry[];
  hasMore: boolean;
  loading: boolean;
  patch: GitDiffPatchResult | null;
  selectedFile: GitDiffFileEntry | null;
  stats: GitDiffRepoStat[];
  onBack(): void;
  onCommit(message: string): void;
  onLoadMore(): void;
  onOpenFile(file: GitDiffFileEntry): void;
  onPush(): void;
  onRefresh(): void;
};

export function DiffScreen({
  actionError,
  actionMessage,
  busy,
  error,
  files,
  hasMore,
  loading,
  patch,
  selectedFile,
  stats,
  onBack,
  onCommit,
  onLoadMore,
  onOpenFile,
  onPush,
  onRefresh,
}: DiffScreenProps) {
  const { colors } = useAppTheme();
  const [commitOpen, setCommitOpen] = useState(false);
  const groups = useMemo(() => groupDiffFiles(files), [files]);
  const patchLines = useMemo(() => parsePatchLines(patch?.patch ?? ""), [patch?.patch]);

  const confirmPush = () => {
    Alert.alert(
      "Push commits?",
      "This will publish every ahead workspace branch to its configured remote.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Push", style: "destructive", onPress: onPush },
      ],
    );
  };

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
        <View style={styles.titleCopy}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>
            Changes
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>Workspace diff</Text>
        </View>
        <Pressable
          accessibilityLabel="Refresh changes"
          accessibilityRole="button"
          disabled={loading}
          onPress={onRefresh}
          style={styles.headerAction}
        >
          <Text style={{ color: colors.accent }}>Refresh</Text>
        </Pressable>
      </View>

      {loading && stats.length === 0 && files.length === 0 ? (
        <StateView kind="loading" title="Loading changes" />
      ) : error && stats.length === 0 && files.length === 0 ? (
        <StateView
          actionLabel="Retry"
          description={error}
          kind="error"
          onAction={onRefresh}
          title="Could not load changes"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <ScrollView
            contentContainerStyle={styles.statsRow}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {stats.map((stat) => (
              <View
                key={stat.repo}
                style={[
                  styles.statCard,
                  { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
                ]}
              >
                <Text style={[styles.repo, { color: colors.textPrimary }]}>{stat.repo}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  {stat.branch ?? "detached"} → {stat.base ?? "base"}
                </Text>
                <View style={styles.counters}>
                  <Text style={{ color: colors.statusGreen, fontWeight: "700" }}>
                    +{stat.additions}
                  </Text>
                  <Text style={{ color: colors.statusRed, fontWeight: "700" }}>
                    -{stat.deletions}
                  </Text>
                  <Text style={{ color: colors.textMuted }}>{stat.filesChanged} files</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          {actionMessage ? (
            <Text
              style={[
                styles.message,
                { color: actionError ? colors.statusRed : colors.statusGreen },
              ]}
            >
              {actionMessage}
            </Text>
          ) : null}
          {error ? (
            <Text style={[styles.message, { color: colors.statusRed }]}>{error}</Text>
          ) : null}

          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Files</Text>
            <Text style={{ color: colors.textMuted }}>{files.length} loaded</Text>
          </View>
          {groups.map((group) => (
            <View key={group.repo} style={styles.group}>
              <Text style={[styles.groupTitle, { color: colors.textMuted }]}>{group.repo}</Text>
              {group.files.map((file) => {
                const selected =
                  selectedFile?.repo === file.repo && selectedFile.path === file.path;
                return (
                  <Pressable
                    accessibilityLabel={`Open diff ${file.repo} ${file.path}`}
                    accessibilityRole="button"
                    key={`${file.repo}:${file.path}`}
                    onPress={() => onOpenFile(file)}
                    style={[
                      styles.fileRow,
                      {
                        backgroundColor: selected ? colors.accentSoft : colors.bgPanel,
                        borderColor: selected ? colors.accent : colors.borderSubtle,
                      },
                    ]}
                  >
                    <View style={styles.fileCopy}>
                      <Text
                        numberOfLines={1}
                        style={{ color: selected ? colors.accent : colors.textPrimary }}
                      >
                        {file.path}
                      </Text>
                      <Text style={{ color: colors.textMuted, fontSize: 12 }}>{file.status}</Text>
                    </View>
                    {file.binary ? (
                      <Text style={{ color: colors.textMuted }}>binary</Text>
                    ) : (
                      <View style={styles.counters}>
                        <Text style={{ color: colors.statusGreen }}>+{file.additions ?? "?"}</Text>
                        <Text style={{ color: colors.statusRed }}>-{file.deletions ?? "?"}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
          {hasMore ? (
            <Pressable
              accessibilityLabel="Load more files"
              accessibilityRole="button"
              disabled={loading}
              onPress={onLoadMore}
              style={[styles.secondaryButton, { borderColor: colors.borderStrong }]}
            >
              <Text style={{ color: colors.textPrimary }}>
                {loading ? "Loading…" : "Load more files"}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Patch</Text>
            {patch?.truncated ? <Text style={{ color: colors.statusAmber }}>truncated</Text> : null}
          </View>
          <ScrollView
            contentContainerStyle={styles.patchContent}
            horizontal
            style={[styles.patch, { backgroundColor: colors.bgPanel }]}
          >
            <View>
              {selectedFile?.binary ? (
                <Text style={{ color: colors.textMuted }}>Binary preview is unavailable.</Text>
              ) : patchLines.length > 0 ? (
                patchLines.map((line, index) => (
                  <Text
                    key={`${index}:${line.text}`}
                    selectable
                    style={[
                      styles.patchLine,
                      {
                        backgroundColor: patchBackground(line.kind, colors),
                        color: patchColor(line.kind, colors),
                      },
                    ]}
                  >
                    {line.text || " "}
                  </Text>
                ))
              ) : (
                <Text style={{ color: colors.textMuted }}>Select a file to load its patch.</Text>
              )}
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="Commit changes"
              accessibilityRole="button"
              disabled={busy || files.length === 0}
              onPress={() => setCommitOpen(true)}
              style={[styles.primaryButton, { backgroundColor: colors.accent }]}
            >
              <Text style={{ color: colors.onAccent, fontWeight: "700" }}>Commit changes</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Push commits"
              accessibilityRole="button"
              disabled={busy}
              onPress={confirmPush}
              style={[styles.secondaryButton, { borderColor: colors.borderStrong }]}
            >
              <Text style={{ color: colors.textPrimary }}>Push commits</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
      <CommitSheet
        busy={busy}
        onClose={() => setCommitOpen(false)}
        onCommit={onCommit}
        visible={commitOpen}
      />
    </SafeAreaView>
  );
}

function patchColor(kind: PatchLineKind, colors: ReturnType<typeof useAppTheme>["colors"]): string {
  if (kind === "addition") return colors.statusGreen;
  if (kind === "deletion") return colors.statusRed;
  if (kind === "hunk") return colors.statusPurple;
  if (kind === "meta") return colors.textMuted;
  return colors.textSecondary;
}

function patchBackground(
  kind: PatchLineKind,
  colors: ReturnType<typeof useAppTheme>["colors"],
): string {
  if (kind === "addition") return `${colors.statusGreen}14`;
  if (kind === "deletion") return `${colors.statusRed}14`;
  return "transparent";
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm },
  back: { fontSize: 34, lineHeight: 36 },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  counters: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  fileCopy: { flex: 1, gap: spacing.xxs },
  fileRow: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    padding: spacing.sm,
  },
  group: { gap: spacing.xs },
  groupTitle: { fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  headerAction: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 60 },
  heading: { fontSize: 18, fontWeight: "700" },
  message: { borderRadius: radii.sm, paddingHorizontal: spacing.sm },
  patch: { borderRadius: radii.md, minHeight: 128, maxHeight: 420 },
  patchContent: { minWidth: "100%", padding: spacing.sm },
  patchLine: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 12,
    lineHeight: 19,
    paddingHorizontal: spacing.xs,
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: radii.md,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  repo: { fontSize: 16, fontWeight: "700" },
  safeArea: { flex: 1 },
  secondaryButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  sectionHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  statCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    minWidth: 210,
    padding: spacing.md,
  },
  statsRow: { gap: spacing.sm },
  titleCopy: { alignItems: "center" },
});
