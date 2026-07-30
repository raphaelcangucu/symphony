import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { PullRequest } from "@/api/contracts";
import { radii, spacing, type ThemeColors } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import { pullRequestHealth, type PullRequestHealthTone } from "./issue-pr-state";

export function IssuePullRequestTab({
  error,
  loading,
  onOpen,
  onRefresh,
  pullRequests,
}: {
  error: string | null;
  loading: boolean;
  onOpen(pullRequest: PullRequest): void;
  onRefresh(): void;
  pullRequests: PullRequest[];
}) {
  const { colors } = useAppTheme();

  if (error && pullRequests.length === 0) {
    return <TabState label={error} action="Retry" onAction={onRefresh} />;
  }
  if (loading && pullRequests.length === 0) {
    return <TabState label="Loading pull requests" />;
  }
  if (pullRequests.length === 0) {
    return <TabState label="No pull request is linked to this task." />;
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.toolbar}>
        <Text style={{ color: colors.textMuted }}>
          {pullRequests.length === 1
            ? "1 related pull request"
            : `${pullRequests.length} related pull requests`}
        </Text>
        <Pressable accessibilityRole="button" onPress={onRefresh}>
          <Text style={{ color: colors.accent }}>Refresh</Text>
        </Pressable>
      </View>
      {pullRequests.map((pullRequest) => (
        <PullRequestCard
          colors={colors}
          key={`${pullRequest.repo}:${pullRequest.number}`}
          onOpen={() => onOpen(pullRequest)}
          pullRequest={pullRequest}
        />
      ))}
    </ScrollView>
  );
}

function PullRequestCard({
  colors,
  onOpen,
  pullRequest,
}: {
  colors: ThemeColors;
  onOpen(): void;
  pullRequest: PullRequest;
}) {
  const health = pullRequestHealth(pullRequest);
  return (
    <View
      style={[styles.card, { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle }]}
    >
      <View style={styles.heading}>
        <View style={styles.grow}>
          <Text style={[styles.identifier, { color: colors.textPrimary }]}>
            PR #{pullRequest.number}
          </Text>
          <Text style={{ color: colors.textPrimary }}>
            {pullRequest.title || "Untitled pull request"}
          </Text>
        </View>
        <TonePill colors={colors} tone={health.tone} />
      </View>
      <Text style={{ color: colors.textMuted }}>
        {pullRequest.headRef || "head"} → {pullRequest.baseRef || "base"}
      </Text>
      <View style={styles.checks}>
        {health.checks.map((check, index) => (
          <View style={styles.check} key={`${check.label}:${index}`}>
            <View
              accessibilityLabel={`${toneLabel(check.tone)} status`}
              style={[styles.dot, { backgroundColor: toneColor(colors, check.tone) }]}
            />
            <Text style={[styles.grow, { color: colors.textSecondary }]}>{check.label}</Text>
            <Text style={{ color: colors.textPrimary }}>{toneLabel(check.tone)}</Text>
          </View>
        ))}
      </View>
      {health.problemCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpen}
          style={[
            styles.problem,
            {
              backgroundColor: `${colors.statusRed}18`,
              borderColor: colors.statusRed,
            },
          ]}
        >
          <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>
            {health.problemCount} {health.problemCount === 1 ? "problem blocks" : "problems block"}{" "}
            merge
          </Text>
          <Text style={{ color: colors.textSecondary }}>
            Open the pull request to inspect and resolve the failures.
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel={`Open pull request ${pullRequest.number}`}
        accessibilityRole="button"
        onPress={onOpen}
        style={[styles.openButton, { borderColor: colors.borderStrong }]}
      >
        <Text style={{ color: colors.textPrimary }}>Open pull request</Text>
      </Pressable>
    </View>
  );
}

function TonePill({ colors, tone }: { colors: ThemeColors; tone: PullRequestHealthTone }) {
  const color = toneColor(colors, tone);
  return (
    <View style={[styles.pill, { backgroundColor: `${color}20` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={{ color: colors.textPrimary }}>{toneLabel(tone)}</Text>
    </View>
  );
}

function TabState({
  action,
  label,
  onAction,
}: {
  action?: string;
  label: string;
  onAction?: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.state}>
      <Text style={{ color: colors.textMuted }}>{label}</Text>
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction}>
          <Text style={{ color: colors.accent }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function toneColor(colors: ThemeColors, tone: PullRequestHealthTone): string {
  if (tone === "success") return colors.statusGreen;
  if (tone === "failure") return colors.statusRed;
  return colors.statusAmber;
}

function toneLabel(tone: PullRequestHealthTone): string {
  if (tone === "success") return "Passed";
  if (tone === "failure") return "Failed";
  return "Pending";
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  check: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 32 },
  checks: { gap: spacing.xxs },
  content: { gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.xxl },
  dot: { borderRadius: radii.pill, height: 8, width: 8 },
  grow: { flex: 1 },
  heading: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  identifier: { fontWeight: "700" },
  openButton: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  pill: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  problem: {
    borderLeftWidth: 3,
    borderRadius: radii.sm,
    gap: spacing.xxs,
    padding: spacing.sm,
  },
  state: { alignItems: "center", gap: spacing.sm, padding: spacing.xl },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
