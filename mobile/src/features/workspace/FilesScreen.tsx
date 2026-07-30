import { useMemo, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ThreadFile, ThreadFileContent } from "@/api/contracts";
import { StateView } from "@/components/StateView";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type FilesScreenProps = {
  files: ThreadFile[];
  selectedPath: string | null;
  preview: ThreadFileContent | null;
  loading: boolean;
  error: string | null;
  onBack(): void;
  onOpenDocument(path: string): void;
  onRefresh(): void;
};

export function FilesScreen({
  files,
  selectedPath,
  preview,
  loading,
  error,
  onBack,
  onOpenDocument,
  onRefresh,
}: FilesScreenProps) {
  const { colors } = useAppTheme();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return files;
    return files.filter((file) =>
      `${file.title} ${file.path}`.toLocaleLowerCase().includes(normalized),
    );
  }, [files, query]);

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
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>
          Files
        </Text>
        <Pressable
          accessibilityLabel="Refresh files"
          accessibilityRole="button"
          onPress={onRefresh}
          style={styles.headerAction}
        >
          <Text style={{ color: colors.accent }}>Refresh</Text>
        </Pressable>
      </View>
      <TextInput
        accessibilityLabel="Search files"
        onChangeText={setQuery}
        placeholder="Search files"
        placeholderTextColor={colors.textMuted}
        style={[
          styles.search,
          {
            backgroundColor: colors.bgPanel,
            borderColor: colors.borderSubtle,
            color: colors.textPrimary,
          },
        ]}
        value={query}
      />
      {loading && files.length === 0 ? (
        <StateView kind="loading" title="Loading files" />
      ) : error && files.length === 0 ? (
        <StateView
          actionLabel="Retry"
          description={error}
          kind="error"
          onAction={onRefresh}
          title="Could not load files"
        />
      ) : (
        <View style={styles.workspace}>
          <ScrollView style={[styles.fileList, { borderColor: colors.borderSubtle }]}>
            {visible.map((file) => {
              const selected = selectedPath === file.path;
              return (
                <Pressable
                  accessibilityLabel={`Open file ${file.path}`}
                  accessibilityRole="button"
                  key={file.id}
                  onPress={() => onOpenDocument(file.path)}
                  style={[
                    styles.fileRow,
                    { backgroundColor: selected ? colors.accentSoft : colors.bgBase },
                  ]}
                >
                  <Text style={{ color: selected ? colors.accent : colors.textPrimary }}>
                    {file.title}
                  </Text>
                  <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 12 }}>
                    {file.path}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView
            contentContainerStyle={styles.previewContent}
            style={[styles.preview, { backgroundColor: colors.bgPanel }]}
          >
            {selectedPath ? (
              <>
                <Text style={[styles.path, { color: colors.textMuted }]}>{selectedPath}</Text>
                <FilePreview preview={preview} selectedPath={selectedPath} />
              </>
            ) : (
              <Text style={{ color: colors.textMuted }}>Select a file to preview.</Text>
            )}
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

function FilePreview({
  preview,
  selectedPath,
}: {
  preview: ThreadFileContent | null;
  selectedPath: string;
}) {
  const { colors } = useAppTheme();
  if (!preview || preview.path !== selectedPath) {
    return <Text style={{ color: colors.textMuted }}>Loading preview…</Text>;
  }
  if (preview.kind === "image" && preview.dataUri) {
    return (
      <Image
        accessibilityLabel={`Preview image ${selectedPath}`}
        resizeMode="contain"
        source={{ uri: preview.dataUri }}
        style={styles.image}
      />
    );
  }
  if (preview.kind === "markdown" && preview.content !== null) {
    return <MarkdownPreview content={preview.content} />;
  }
  return (
    <Text selectable style={[styles.source, { color: colors.textPrimary }]}>
      {preview.content ?? "Preview unavailable."}
    </Text>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.markdown}>
      {content.split("\n").map((line, index) => {
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          return (
            <Text
              key={index}
              style={[
                styles.markdownHeading,
                { color: colors.textPrimary, fontSize: heading[1]!.length === 1 ? 24 : 19 },
              ]}
            >
              {heading[2]}
            </Text>
          );
        }
        return (
          <Text key={index} selectable style={[styles.markdownText, { color: colors.textPrimary }]}>
            {line.replace(/^[-*]\s+/, "• ")}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  back: { fontSize: 34, lineHeight: 36 },
  fileList: { borderRightWidth: StyleSheet.hairlineWidth, flex: 0.42 },
  fileRow: { gap: spacing.xxs, minHeight: 56, padding: spacing.sm },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  headerAction: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 56 },
  heading: { fontSize: 18, fontWeight: "700" },
  image: { height: 320, width: "100%" },
  markdown: { gap: spacing.xs },
  markdownHeading: { fontWeight: "800", marginTop: spacing.sm },
  markdownText: { fontSize: 15, lineHeight: 22 },
  path: { fontSize: 12 },
  preview: { flex: 0.58 },
  previewContent: { gap: spacing.sm, padding: spacing.md },
  safeArea: { flex: 1 },
  search: {
    borderRadius: radii.md,
    borderWidth: 1,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  source: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 13,
    lineHeight: 20,
  },
  workspace: { flex: 1, flexDirection: "row" },
});
