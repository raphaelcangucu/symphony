import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight, FolderGit2, Layers } from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import type { ProjectSummary } from "../../../src/api/contracts";
import { createHostTrackerClient } from "../../../src/dev10x/transport/host-tracker-client";
import { useHostClient } from "../../../src/dev10x/transport/client-context";
import { usePersistedHosts } from "../../../src/dev10x/transport/use-persisted-hosts";
import { colors, radii, spacing, typography } from "../../../src/dev10x/theme/mobile-theme";

export default function HostProjectsPage() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, state } = useHostClient(hostId);
  const { hosts } = usePersistedHosts();
  const hostName =
    hosts.find((host) => host.id === hostId || host.hostId === hostId)?.name ?? "Máquina";
  const tracker = useMemo(
    () => (client && hostId ? createHostTrackerClient(hostId, client) : null),
    [client, hostId],
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tracker || state !== "connected") return;
    setLoading(true);
    setError(null);
    try {
      setProjects(await tracker.projects());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os projetos");
    } finally {
      setLoading(false);
    }
  }, [state, tracker]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => router.replace("/")}
          accessibilityLabel="Voltar"
        >
          <ChevronLeft size={21} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {hostName}
        </Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => router.replace(`/h/${hostId}`)}
          accessibilityLabel="Abrir workspaces"
        >
          <Layers size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <FlatList
        data={projects}
        keyExtractor={(project) => project.id}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshing={loading && projects.length > 0}
        onRefresh={() => void load()}
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>Projetos</Text>
            <Text style={styles.subtitle}>
              {state === "connected" ? "Escolha onde deseja trabalhar." : "Reconectando à máquina…"}
            </Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : error ? (
            <View style={styles.empty}>
              <Text style={styles.error}>{error}</Text>
              <Pressable style={styles.retry} onPress={() => void load()}>
                <Text style={styles.retryText}>Tentar novamente</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nenhum projeto nesta máquina</Text>
              <Text style={styles.emptyCopy}>
                Adicione um projeto no Symphony para acessá-lo pelo app.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => router.push(`/h/${hostId}/projects/${encodeURIComponent(item.slug)}`)}
            accessibilityLabel={`Abrir projeto ${item.name}`}
          >
            <View style={styles.rowIcon}>
              <FolderGit2 size={20} color={colors.textSecondary} />
            </View>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {item.slug}
              </Text>
            </View>
            <ChevronRight size={17} color={colors.textMuted} />
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    height: 58,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: colors.textPrimary, fontSize: typography.titleSize, fontWeight: "600" },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    padding: spacing.md,
  },
  rowPressed: { backgroundColor: colors.bgRaised },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.row,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgRaised,
    marginRight: spacing.md,
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: typography.metaSize, marginTop: 2 },
  gap: { height: spacing.sm },
  empty: { paddingTop: spacing.xl * 3, alignItems: "center", paddingHorizontal: spacing.xl },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: "600",
    textAlign: "center",
  },
  emptyCopy: {
    color: colors.textMuted,
    fontSize: typography.bodySize,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  error: { color: colors.statusRed, fontSize: typography.bodySize, textAlign: "center" },
  retry: { marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: "600" },
});
