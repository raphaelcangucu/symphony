import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ThreadDocument } from "@/api/contracts";
import { StateView } from "@/components/StateView";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type FilesScreenProps = {
  documents: ThreadDocument[];
  selectedPath: string | null;
  content: string | null;
  loading: boolean;
  error: string | null;
  onBack(): void;
  onOpenDocument(path: string): void;
  onRefresh(): void;
};

export function FilesScreen({
  documents,
  selectedPath,
  content,
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
    if (!normalized) return documents;
    return documents.filter((document) =>
      `${document.title} ${document.path}`.toLocaleLowerCase().includes(normalized),
    );
  }, [documents, query]);

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
      {loading && documents.length === 0 ? (
        <StateView kind="loading" title="Loading files" />
      ) : error && documents.length === 0 ? (
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
            {visible.map((document) => {
              const selected = selectedPath === document.path;
              return (
                <Pressable
                  accessibilityLabel={`Open file ${document.path}`}
                  accessibilityRole="button"
                  key={document.id}
                  onPress={() => onOpenDocument(document.path)}
                  style={[
                    styles.fileRow,
                    { backgroundColor: selected ? colors.accentSoft : colors.bgBase },
                  ]}
                >
                  <Text style={{ color: selected ? colors.accent : colors.textPrimary }}>
                    {document.title}
                  </Text>
                  <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 12 }}>
                    {document.path}
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
                <Text selectable style={[styles.source, { color: colors.textPrimary }]}>
                  {content ?? "Loading preview…"}
                </Text>
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
