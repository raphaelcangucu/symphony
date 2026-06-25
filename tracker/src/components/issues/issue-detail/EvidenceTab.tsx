import { ClipboardCheck, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AttachmentImage } from "@/components/shared/AttachmentImage";
import { AttachmentVideo } from "@/components/shared/AttachmentVideo";
import { CommitEvidenceSection } from "@/components/issues/issue-detail/CommitEvidenceSection";
import { EvidenceStatusPill } from "@/components/issues/issue-detail/EvidenceStatusPill";
import { EvidenceTextViewerTrigger } from "@/components/issues/issue-detail/EvidenceTextViewer";
import { ReturnToAgentPanel } from "@/components/issues/issue-detail/ReturnToAgentPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  assessEvidenceAttention,
  evidenceAttentionSummary,
  type EvidenceAttention,
} from "@/lib/evidenceStatus";
import {
  artifactCaption,
  artifactDisplayTitle,
  artifactIntent,
  artifactNavigations,
  isExternalArtifact,
  isPreviewableTextArtifact,
  runNavigations,
  runObjective,
  runProofText,
} from "@/lib/evidenceArtifacts";
import {
  clearFailedIssueEvidence,
  clearIssueEvidence,
  deleteEvidenceRun,
  evidenceArtifactUrl,
} from "@/services/evidence";
import { cn } from "@/lib/utils";
import type { WorkflowTrackerConfig } from "@/lib/workflowTracker";
import type { CommitEvidenceSummary, CommitEvidenceWorkspace } from "@/types/commitEvidence";
import type { EvidenceArtifactRef, EvidenceRecord, EvidenceRun } from "@/types/evidence";
import type { Issue } from "@/types/issue";

interface EvidenceTabProps {
  projectSlug: string;
  identifier: string;
  records: EvidenceRecord[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void | Promise<void>;
  commits?: CommitEvidenceSummary[];
  commitWorkspace?: CommitEvidenceWorkspace | null;
  commitsLoading?: boolean;
  commitsError?: string | null;
  onRefreshCommits?: () => void;
  showContinueWork?: boolean;
  issue?: Issue;
  trackerConfig?: WorkflowTrackerConfig;
  onIssueUpdated?: (issue: Issue) => void;
}

export function EvidenceTab({
  projectSlug,
  identifier,
  records,
  loading,
  error,
  onRefresh,
  commits = [],
  commitWorkspace = null,
  commitsLoading = false,
  commitsError = null,
  onRefreshCommits,
  showContinueWork = false,
  issue,
  trackerConfig,
  onIssueUpdated,
}: EvidenceTabProps) {
  const { t } = useTranslation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const evidenceAttention = assessEvidenceAttention(records);
  const attentionSummary = evidenceAttentionSummary(evidenceAttention);
  const canContinueWork =
    showContinueWork && issue && trackerConfig && evidenceAttention.kind !== "none";
  const hasFailedRecords = records.some((record) => record.status !== "passed");

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await Promise.resolve(onRefresh());
    } catch {
      setActionError(t("issue.evidence.tab.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  function handleClearFailed() {
    if (!window.confirm(t("issue.evidence.tab.clearFailedConfirm"))) return;
    void runAction(async () => {
      await clearFailedIssueEvidence(projectSlug, identifier);
    });
  }

  function handleClearAll() {
    if (!window.confirm(t("issue.evidence.tab.clearAllConfirm"))) return;
    void runAction(async () => {
      await clearIssueEvidence(projectSlug, identifier);
    });
  }

  function handleDeleteRun(runId: string) {
    if (!window.confirm(t("issue.evidence.tab.deleteRunConfirm", { runId }))) return;
    void runAction(async () => {
      await deleteEvidenceRun(projectSlug, identifier, runId);
    });
  }

  return (
    <div className="space-y-4">
      {canContinueWork ? (
        <ReturnToAgentPanel
          projectSlug={projectSlug}
          issue={issue}
          trackerConfig={trackerConfig}
          evidenceAttention={evidenceAttention}
          initialTemplate="evidence"
          onIssueUpdated={onIssueUpdated}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardCheck className="h-4 w-4 opacity-80" />
          {t("issue.evidence.tab.title")}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {hasFailedRecords ? (
            <Button
              disabled={busy || loading}
              onClick={handleClearFailed}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("issue.evidence.tab.clearFailed")}
            </Button>
          ) : null}
          {records.length > 0 ? (
            <Button
              disabled={busy || loading}
              onClick={handleClearAll}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("issue.evidence.tab.clearAll")}
            </Button>
          ) : null}
          <Button disabled={busy || loading} onClick={onRefresh} size="sm" type="button" variant="ghost">
            <RefreshCw className={cn("h-3.5 w-3.5", (loading || busy) && "animate-spin")} />
            {t("issue.evidence.tab.refresh")}
          </Button>
        </div>
      </div>

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!error && evidenceAttention.kind !== "none" && !canContinueWork ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">{attentionSummary}</p>
      ) : null}

      {!error && records.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {loading ? t("issue.evidence.tab.loading") : t("issue.evidence.tab.empty")}
        </p>
      ) : null}

      {records.map((record) => (
        <EvidenceCard
          key={record.id}
          busy={busy}
          identifier={identifier}
          onDelete={handleDeleteRun}
          projectSlug={projectSlug}
          record={record}
        />
      ))}

      <CommitEvidenceSection
        commits={commits}
        error={commitsError}
        identifier={identifier}
        loading={commitsLoading}
        onRefresh={() => onRefreshCommits?.()}
        projectSlug={projectSlug}
        workspace={commitWorkspace}
      />
    </div>
  );
}

function EvidenceCard({
  projectSlug,
  identifier,
  record,
  onDelete,
  busy,
}: {
  projectSlug: string;
  identifier: string;
  record: EvidenceRecord;
  onDelete: (runId: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const artifactUrl = (relative: string) =>
    evidenceArtifactUrl(projectSlug, identifier, record.runId, relative);
  const runGroups = groupRunsByTask(record.runs, t);

  return (
    <div className="space-y-4 rounded-lg border p-3" data-testid={`evidence-${record.runId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <EvidenceStatusPill status={record.status} />
        <span className="font-mono text-xs text-muted-foreground">{record.runId}</span>
        {record.uiChange ? <Badge variant="outline">{t("issue.evidence.tab.uiChange")}</Badge> : null}
        {record.insertedAt ? (
          <span className="text-xs text-muted-foreground">
            {new Date(record.insertedAt).toLocaleString()}
          </span>
        ) : null}
        <Button
          aria-label={t("issue.evidence.tab.deleteRun", { runId: record.runId })}
          className="ml-auto"
          disabled={busy}
          onClick={() => onDelete(record.runId)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>

      {record.runs.length > 0 ? (
        <div className="space-y-4">
          {runGroups.map((group) => (
            <section className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-3" key={group.key}>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">{group.title}</h3>
                <p className="text-xs text-muted-foreground">
                  {t("issue.evidence.tab.taskGroup.runCount", { count: group.runs.length })}
                </p>
              </div>
              <div className="space-y-3">
                {group.runs.map(({ run, index }) => (
                  <EvidenceRunSection
                    artifactUrl={artifactUrl}
                    index={index}
                    key={`${run.kind}-${run.repo}-${index}`}
                    run={run}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface EvidenceRunGroup {
  key: string;
  title: string;
  runs: Array<{ run: EvidenceRun; index: number }>;
}

function groupRunsByTask(runs: EvidenceRun[], t: TFunction): EvidenceRunGroup[] {
  const groups = new Map<string, EvidenceRunGroup>();
  const ungroupedTitle = t("issue.evidence.tab.taskGroup.ungrouped");

  runs.forEach((run, index) => {
    const title = run.task_title?.trim() || ungroupedTitle;
    const key = run.task_id?.trim() || `ungrouped:${title}`;
    const existing = groups.get(key);

    if (existing) {
      existing.runs.push({ run, index });
      return;
    }

    groups.set(key, {
      key,
      title,
      runs: [{ run, index }],
    });
  });

  return [...groups.values()];
}

function VisualArtifactCard({
  run,
  ref: artifactRef,
  artifactUrl,
  type,
}: {
  run: EvidenceRun;
  ref: EvidenceArtifactRef;
  artifactUrl: string;
  type: "screenshot" | "video";
}) {
  const { t } = useTranslation();
  const intent = artifactIntent(run, artifactRef);
  const navigations = artifactNavigations(run, artifactRef);
  const filename = artifactCaption(run, artifactRef);
  const alt = artifactDisplayTitle(run, artifactRef);

  return (
    <article className="space-y-2 rounded-md border border-border/50 bg-background/60 p-2.5">
      <div className="space-y-1">
        <p className="text-sm font-medium leading-snug">{intent}</p>
        {navigations ? (
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">{navigations}</p>
        ) : null}
        <p className="truncate text-[11px] text-muted-foreground" title={filename}>
          {filename}
        </p>
      </div>

      {type === "screenshot" ? (
        <AttachmentImage alt={alt} layout="thumbnail" showCaption={false} src={artifactUrl} />
      ) : (
        <AttachmentVideo
          className="w-full rounded border"
          description={undefined}
          label={t("issue.evidence.tab.artifactVideoAria", { name: intent })}
          src={artifactUrl}
        />
      )}
    </article>
  );
}

function EvidenceRunSection({
  run,
  index,
  artifactUrl,
}: {
  run: EvidenceRun;
  index: number;
  artifactUrl: (relative: string) => string;
}) {
  const { t } = useTranslation();
  const objective = runObjective(run);
  const navigations = runNavigations(run);
  const screenshots = run.screenshots ?? [];
  const videos = run.videos ?? [];
  const hasVisuals = screenshots.length > 0 || videos.length > 0;
  const hasMultipleVisuals = screenshots.length + videos.length > 1;
  const artifacts = collectRunArtifacts(run);

  return (
    <section className="space-y-3 rounded-md border border-border/40 bg-background p-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-medium">
            {runSectionTitle(run, t)}
          </h4>
          <EvidenceStatusPill status={run.status} />
        </div>

        {objective && !hasMultipleVisuals ? (
          <p className="text-sm text-foreground/90">
            <span className="font-medium text-muted-foreground">
              {t("issue.evidence.tab.runSection.objective")}:{" "}
            </span>
            {objective}
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          <span className="font-medium">{t("issue.evidence.tab.runSection.command")}: </span>
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{run.command}</code>
        </p>

        {run.blocked_reason ? (
          <p className="text-xs text-amber-800 dark:text-amber-200">
            <span className="font-medium">{t("issue.evidence.tab.runSection.blockedReason")}: </span>
            {run.blocked_reason}
          </p>
        ) : null}

        {navigations.length > 0 && !hasMultipleVisuals ? (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">{t("issue.evidence.tab.runSection.navigations")}: </span>
            <span className="font-mono">{navigations.join(" → ")}</span>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">{summaryText(run, t)}</p>
      </div>

      {hasVisuals ? (
        <div className="space-y-3">
          {screenshots.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("issue.evidence.tab.screenshots")}
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {screenshots.map((ref) => (
                  <VisualArtifactCard
                    artifactUrl={artifactUrl(ref.path)}
                    key={`${index}-${ref.path}`}
                    ref={ref}
                    run={run}
                    type="screenshot"
                  />
                ))}
              </div>
            </div>
          ) : null}

          {videos.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("issue.evidence.tab.videos")}
              </p>
              <div className="space-y-4">
                {videos.map((ref) => (
                  <VisualArtifactCard
                    artifactUrl={artifactUrl(ref.path)}
                    key={`${index}-${ref.path}`}
                    ref={ref}
                    run={run}
                    type="video"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {artifacts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {artifacts.map((artifact) => (
            <RunArtifactLink
              artifact={artifact}
              artifactUrl={artifactUrl}
              key={artifact.relative}
              run={run}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

interface RunArtifact {
  relative: string;
  title: string;
  kind: "text" | "external";
  artifactKind: "report" | "trace";
}

function collectRunArtifacts(run: EvidenceRun): RunArtifact[] {
  const artifacts: RunArtifact[] = [];

  if (run.report) {
    artifacts.push({
      relative: run.report,
      title: run.report.split("/").pop() ?? run.report,
      artifactKind: "report",
      kind: isPreviewableTextArtifact(run.report) ? "text" : "external",
    });
  }

  if (run.trace) {
    artifacts.push({
      relative: run.trace,
      title: run.trace.split("/").pop() ?? run.trace,
      artifactKind: "trace",
      kind: isExternalArtifact(run.trace) ? "external" : "text",
    });
  }

  return artifacts;
}

function RunArtifactLink({
  artifact,
  artifactUrl,
  run,
  t,
}: {
  artifact: RunArtifact;
  artifactUrl: (relative: string) => string;
  run: EvidenceRun;
  t: TFunction;
}) {
  const url = artifactUrl(artifact.relative);
  const label =
    artifact.artifactKind === "report"
      ? t("issue.evidence.tab.reportLink", { kind: run.kind, repo: run.repo })
      : t("issue.evidence.tab.traceLink", { kind: run.kind, repo: run.repo });

  if (artifact.kind === "text") {
    return (
      <EvidenceTextViewerTrigger
        label={label}
        title={artifact.title}
        url={url}
      />
    );
  }

  return (
    <a
      className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/30 px-2 py-1 text-xs text-primary transition hover:bg-muted/60"
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      <span className="sr-only">{t("issue.evidence.tab.openExternal")}</span>
    </a>
  );
}

function runSectionTitle(run: EvidenceRun, t: TFunction): string {
  const scope = runScopeLabel(run, t);
  const scopeSuffix = scope ? ` (${scope})` : "";

  if (run.kind === "e2e") {
    return `${t("issue.evidence.tab.runSection.e2eTitle", { repo: run.repo })}${scopeSuffix}`;
  }

  if (run.kind === "unit") {
    return `${t("issue.evidence.tab.runSection.unitTitle", { repo: run.repo })}${scopeSuffix}`;
  }

  return `${t("issue.evidence.tab.runSection.genericTitle", { kind: run.kind, repo: run.repo })}${scopeSuffix}`;
}

function runScopeLabel(run: EvidenceRun, t: TFunction): string | null {
  const proofText = runProofText(run);
  if (proofText) return proofText;

  const quoted = run.command.match(/['"]([^'"]+\.(?:test|spec)\.[a-z]+)['"]/i);
  if (quoted?.[1]) return quoted[1].split("/").slice(-2).join("/");

  const playwrightSpec = [...run.command.matchAll(/(\S+\.spec\.[a-z]+)/gi)].map((match) => match[1]);
  if (playwrightSpec.length === 1) {
    return playwrightSpec[0]!.split("/").slice(-1)[0] ?? playwrightSpec[0]!;
  }

  if (playwrightSpec.length > 1) {
    return t("issue.evidence.tab.runSection.multipleSpecs", { count: playwrightSpec.length });
  }

  const testPath = run.command.match(/\b(?:tests?\/\S+|components\/\S+\.test\.\w+)\b/i);
  if (testPath?.[0]) return testPath[0].split("/").slice(-2).join("/");

  return null;
}

function summaryText(run: EvidenceRun, t: TFunction): string {
  const summary = run.summary;
  if (!summary) return t("issue.evidence.tab.runSection.noSummary");

  if (typeof summary === "object" && "reason" in summary) {
    const reason = (summary as { reason?: unknown }).reason;
    if (typeof reason === "string" && reason.trim()) return reason.trim();
  }

  if (
    typeof summary.total === "number" &&
    typeof summary.passed === "number" &&
    typeof summary.failed === "number"
  ) {
    return t("issue.evidence.tab.runSummary", {
      passed: summary.passed,
      total: summary.total,
      failed: summary.failed,
    });
  }

  return t("issue.evidence.tab.runSection.noSummary");
}

export type { EvidenceAttention };
