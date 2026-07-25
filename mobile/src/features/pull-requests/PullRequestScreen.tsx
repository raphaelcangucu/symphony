import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  MergePullRequestInput,
  PullRequest,
  PullRequestMergeMethod,
  PullRequestResult,
} from "@/api/contracts";
import { StateView } from "@/components/StateView";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type PullRequestScreenProps = {
  busy: boolean;
  error: string | null;
  loading?: boolean;
  notice: string | null;
  noticeError?: boolean;
  result: PullRequestResult | null;
  onBack(): void;
  onFix(pullRequest: PullRequest): void;
  onLink(url: string): void;
  onMerge(pullRequest: PullRequest, input: MergePullRequestInput): void;
  onRefresh(): void;
  onRerun(pullRequest: PullRequest): void;
  onUnlink(pullRequest: PullRequest): void;
  onUpdateBranch(pullRequest: PullRequest): void;
};

export function PullRequestScreen({
  busy,
  error,
  loading = false,
  notice,
  noticeError = false,
  result,
  onBack,
  onFix,
  onLink,
  onMerge,
  onRefresh,
  onRerun,
  onUnlink,
  onUpdateBranch,
}: PullRequestScreenProps) {
  const { colors } = useAppTheme();
  const [url, setUrl] = useState("");
  const [mergeMethod, setMergeMethod] = useState<PullRequestMergeMethod>("squash");
  const [bypass, setBypass] = useState(false);
  const pullRequests = result?.pullRequests ?? [];

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
            Pull requests
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>Issue delivery</Text>
        </View>
        <Pressable
          accessibilityLabel="Refresh pull requests"
          accessibilityRole="button"
          disabled={busy || loading}
          onPress={onRefresh}
          style={styles.headerAction}
        >
          <Text style={{ color: colors.accent }}>Refresh</Text>
        </Pressable>
      </View>

      {loading && !result ? (
        <StateView kind="loading" title="Loading pull requests" />
      ) : error && !result ? (
        <StateView
          actionLabel="Retry"
          description={error}
          kind="error"
          onAction={onRefresh}
          title="Could not load pull requests"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {result && !result.supported ? (
            <Text style={[styles.notice, { color: colors.statusAmber }]}>
              Pull request discovery is not supported by this project.
            </Text>
          ) : result && !result.available ? (
            <Text style={[styles.notice, { color: colors.statusAmber }]}>
              GitHub is unavailable. Manually linked pull requests remain visible.
            </Text>
          ) : null}
          {notice ? (
            <Text
              style={[
                styles.notice,
                { color: noticeError ? colors.statusRed : colors.statusGreen },
              ]}
            >
              {notice}
            </Text>
          ) : null}
          {error ? <Text style={[styles.notice, { color: colors.statusRed }]}>{error}</Text> : null}

          <View
            style={[
              styles.linkCard,
              { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Link a pull request
            </Text>
            <TextInput
              accessibilityLabel="Pull request URL"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={setUrl}
              placeholder="https://github.com/owner/repo/pull/123"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                {
                  backgroundColor: colors.bgBase,
                  borderColor: colors.borderStrong,
                  color: colors.textPrimary,
                },
              ]}
              value={url}
            />
            <Pressable
              accessibilityLabel="Link pull request"
              accessibilityRole="button"
              disabled={busy || !url.trim()}
              onPress={() => {
                onLink(url.trim());
                setUrl("");
              }}
              style={[styles.primaryButton, { backgroundColor: colors.accent }]}
            >
              <Text style={{ color: colors.onAccent, fontWeight: "700" }}>Link</Text>
            </Pressable>
          </View>

          <View style={styles.mergeOptions}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Merge method</Text>
            <View style={styles.optionRow}>
              {(["merge", "squash", "rebase"] as const).map((method) => (
                <Pressable
                  accessibilityLabel={`Use ${method} merge`}
                  accessibilityRole="button"
                  key={method}
                  onPress={() => setMergeMethod(method)}
                  style={[
                    styles.option,
                    {
                      backgroundColor: mergeMethod === method ? colors.accentSoft : colors.bgPanel,
                      borderColor: mergeMethod === method ? colors.accent : colors.borderSubtle,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: mergeMethod === method ? colors.accent : colors.textSecondary,
                    }}
                  >
                    {method}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityLabel="Bypass merge protections"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: bypass }}
              onPress={() => setBypass((current) => !current)}
              style={styles.checkboxRow}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    backgroundColor: bypass ? colors.statusAmber : "transparent",
                    borderColor: bypass ? colors.statusAmber : colors.borderStrong,
                  },
                ]}
              />
              <Text style={{ color: colors.textSecondary }}>Bypass protections</Text>
            </Pressable>
          </View>

          {pullRequests.length === 0 ? (
            <Text style={{ color: colors.textMuted }}>No pull requests linked yet.</Text>
          ) : (
            pullRequests.map((pullRequest) => (
              <PullRequestCard
                busy={busy}
                bypass={bypass}
                colors={colors}
                key={`${pullRequest.repo}:${pullRequest.number}`}
                mergeMethod={mergeMethod}
                onFix={onFix}
                onMerge={onMerge}
                onRerun={onRerun}
                onUnlink={onUnlink}
                onUpdateBranch={onUpdateBranch}
                pullRequest={pullRequest}
              />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PullRequestCard({
  busy,
  bypass,
  colors,
  mergeMethod,
  pullRequest,
  onFix,
  onMerge,
  onRerun,
  onUnlink,
  onUpdateBranch,
}: {
  busy: boolean;
  bypass: boolean;
  colors: ReturnType<typeof useAppTheme>["colors"];
  mergeMethod: PullRequestMergeMethod;
  pullRequest: PullRequest;
  onFix(pullRequest: PullRequest): void;
  onMerge(pullRequest: PullRequest, input: MergePullRequestInput): void;
  onRerun(pullRequest: PullRequest): void;
  onUnlink(pullRequest: PullRequest): void;
  onUpdateBranch(pullRequest: PullRequest): void;
}) {
  const failedJobs = pullRequest.pipelines.flatMap((pipeline) =>
    pipeline.jobs.filter((job) => failedConclusion(job.conclusion)),
  );
  const confirmFix = () =>
    Alert.alert(
      "Request agent fix?",
      "This posts the failed checks and moves the issue to Rework.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Request fix",
          onPress: () => onFix(pullRequest),
        },
      ],
    );
  const confirmUnlink = () =>
    Alert.alert("Unlink pull request?", "The pull request will no longer appear on this issue.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unlink",
        style: "destructive",
        onPress: () => onUnlink(pullRequest),
      },
    ]);
  const confirmMerge = () =>
    Alert.alert(
      `Merge PR #${pullRequest.number}?`,
      bypass
        ? `This will ${mergeMethod} with protections bypassed and move the issue to Done.`
        : `This will ${mergeMethod} the pull request and move the issue to Done.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Merge",
          style: "destructive",
          onPress: () => onMerge(pullRequest, { method: mergeMethod, bypass }),
        },
      ],
    );

  return (
    <View
      style={[styles.prCard, { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle }]}
    >
      <View style={styles.prHeading}>
        <View style={styles.prCopy}>
          <Text style={[styles.prTitle, { color: colors.textPrimary }]}>
            {pullRequest.title ?? `Pull request #${pullRequest.number}`}
          </Text>
          <Text style={{ color: colors.textMuted }}>
            {pullRequest.repo ?? "repository"} #{pullRequest.number}
          </Text>
        </View>
        <Text style={{ color: pullRequest.merged ? colors.statusPurple : colors.statusGreen }}>
          {pullRequest.state}
        </Text>
      </View>
      <Text style={{ color: colors.textSecondary }}>
        {pullRequest.headRef ?? "head"} → {pullRequest.baseRef ?? "base"}
      </Text>
      <View style={styles.badges}>
        {pullRequest.mergeable === "CONFLICTING" ? (
          <Text style={[styles.badge, { color: colors.statusRed }]}>Conflicts</Text>
        ) : null}
        {pullRequest.baseBehindBy && pullRequest.baseBehindBy > 0 ? (
          <Text style={[styles.badge, { color: colors.statusAmber }]}>
            Behind by {pullRequest.baseBehindBy}
          </Text>
        ) : null}
        {pullRequest.checksState ? (
          <Text style={[styles.badge, { color: checkColor(pullRequest.checksState, colors) }]}>
            Checks: {pullRequest.checksState}
          </Text>
        ) : null}
      </View>
      {pullRequest.pipelines.map((pipeline) => (
        <View key={pipeline.name} style={styles.pipeline}>
          <Text style={[styles.pipelineTitle, { color: colors.textSecondary }]}>
            {pipeline.name}
          </Text>
          {pipeline.jobs.map((job, index) => (
            <View key={`${job.name}:${index}`} style={styles.jobRow}>
              <Text style={{ color: colors.textPrimary }}>{job.name ?? "Check"}</Text>
              <Text style={{ color: checkColor(job.conclusion ?? job.status, colors) }}>
                {job.conclusion ?? job.status ?? "PENDING"}
              </Text>
            </View>
          ))}
        </View>
      ))}
      <View style={styles.actionGrid}>
        {pullRequest.baseBehindBy && pullRequest.baseBehindBy > 0 ? (
          <ActionButton
            busy={busy}
            colors={colors}
            label="Update branch"
            name={`Update branch for PR ${pullRequest.number}`}
            onPress={() => onUpdateBranch(pullRequest)}
          />
        ) : null}
        {failedJobs.length > 0 ? (
          <>
            <ActionButton
              busy={busy}
              colors={colors}
              label="Rerun failed"
              name={`Rerun failed checks for PR ${pullRequest.number}`}
              onPress={() => onRerun(pullRequest)}
            />
            <ActionButton
              busy={busy}
              colors={colors}
              label="Request fix"
              name={`Request agent fix for PR ${pullRequest.number}`}
              onPress={confirmFix}
            />
          </>
        ) : null}
        <ActionButton
          busy={busy}
          colors={colors}
          label="Unlink"
          name={`Unlink PR ${pullRequest.number}`}
          onPress={confirmUnlink}
        />
        <ActionButton
          busy={busy}
          colors={colors}
          label="Merge"
          name={`Merge PR ${pullRequest.number}`}
          onPress={confirmMerge}
          primary
        />
      </View>
    </View>
  );
}

function ActionButton({
  busy,
  colors,
  label,
  name,
  onPress,
  primary = false,
}: {
  busy: boolean;
  colors: ReturnType<typeof useAppTheme>["colors"];
  label: string;
  name: string;
  onPress(): void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={name}
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={[
        styles.actionButton,
        {
          backgroundColor: primary ? colors.accent : colors.bgRaised,
          borderColor: primary ? colors.accent : colors.borderStrong,
        },
      ]}
    >
      <Text style={{ color: primary ? colors.onAccent : colors.textPrimary }}>{label}</Text>
    </Pressable>
  );
}

function failedConclusion(value: string | null): boolean {
  return ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(
    value ?? "",
  );
}

function checkColor(
  value: string | null,
  colors: ReturnType<typeof useAppTheme>["colors"],
): string {
  const normalized = value?.toLocaleLowerCase() ?? "";
  if (normalized.includes("success")) return colors.statusGreen;
  if (
    normalized.includes("fail") ||
    normalized.includes("cancel") ||
    normalized.includes("timed")
  ) {
    return colors.statusRed;
  }
  return colors.statusAmber;
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  back: { fontSize: 34, lineHeight: 36 },
  badge: { fontSize: 12, fontWeight: "700" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  checkbox: { borderRadius: 4, borderWidth: 1, height: 18, width: 18 },
  checkboxRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs, minHeight: 44 },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  headerAction: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 60 },
  heading: { fontSize: 18, fontWeight: "700" },
  input: {
    borderRadius: radii.md,
    borderWidth: 1,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  jobRow: { flexDirection: "row", justifyContent: "space-between" },
  linkCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  mergeOptions: { gap: spacing.xs },
  notice: { borderRadius: radii.sm, lineHeight: 20 },
  option: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 38,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  optionRow: { flexDirection: "row", gap: spacing.xs },
  pipeline: { gap: spacing.xs },
  pipelineTitle: { fontSize: 13, fontWeight: "700" },
  prCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  prCopy: { flex: 1, gap: spacing.xxs },
  prHeading: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  prTitle: { fontSize: 17, fontWeight: "700" },
  primaryButton: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 46,
  },
  safeArea: { flex: 1 },
  sectionTitle: { fontSize: 16, fontWeight: "700" },
  titleCopy: { alignItems: "center" },
});
