import { ClipboardCheck, RefreshCw, Trash2 } from "lucide-react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AttachmentImage } from "@/components/shared/AttachmentImage";
import { AttachmentVideo } from "@/components/shared/AttachmentVideo";
import { CommitEvidenceSection } from "@/components/issues/issue-detail/CommitEvidenceSection";
import { ReturnToAgentPanel } from "@/components/issues/issue-detail/ReturnToAgentPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  assessEvidenceAttention,
  evidenceAttentionSummary,
  type EvidenceAttention,
} from "@/lib/evidenceStatus";
import {
  clearFailedIssueEvidence,
  clearIssueEvidence,
  deleteEvidenceRun,
  evidenceArtifactUrl,
} from "@/services/evidence";
import { cn } from "@/lib/utils";
import type { WorkflowTrackerConfig } from "@/lib/workflowTracker";
import type { CommitEvidenceSummary, CommitEvidenceWorkspace } from "@/types/commitEvidence";
import type { EvidenceRecord, EvidenceRun } from "@/types/evidence";
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

  const screenshots = record.runs.flatMap((run) => run.screenshots ?? []);
  const videos = record.runs.flatMap((run) => run.videos ?? []);

  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid={`evidence-${record.runId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={record.status} />
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
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-2 font-medium">{t("issue.evidence.tab.columns.kind")}</th>
              <th className="py-1 pr-2 font-medium">{t("issue.evidence.tab.columns.repo")}</th>
              <th className="py-1 pr-2 font-medium">{t("issue.evidence.tab.columns.command")}</th>
              <th className="py-1 pr-2 font-medium">{t("issue.evidence.tab.columns.status")}</th>
              <th className="py-1 font-medium">{t("issue.evidence.tab.columns.summary")}</th>
            </tr>
          </thead>
          <tbody>
            {record.runs.map((run, index) => (
              <tr className="border-t" key={`${run.kind}-${run.repo}-${index}`}>
                <td className="py-1.5 pr-2">{run.kind}</td>
                <td className="py-1.5 pr-2">{run.repo}</td>
                <td className="py-1.5 pr-2">
                  <code className="rounded bg-muted px-1 py-0.5">{run.command}</code>
                </td>
                <td className="py-1.5 pr-2">
                  <StatusPill status={run.status} />
                </td>
                <td className="py-1.5">{summaryText(run, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {screenshots.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("issue.evidence.tab.screenshots")}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {screenshots.map((relative) => {
            const filename = relative.split("/").pop() ?? relative;
            return (
              <AttachmentImage
                key={relative}
                alt={filename}
                layout="thumbnail"
                showCaption
                src={artifactUrl(relative)}
              />
            );
          })}
          </div>
        </div>
      ) : null}

      {videos.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("issue.evidence.tab.videos")}
          </p>
          <div className="space-y-3">
          {videos.map((relative) => (
            <AttachmentVideo
              key={relative}
              className="w-full rounded border"
              label={relative.split("/").pop() ?? relative}
              src={artifactUrl(relative)}
            />
          ))}
          </div>
        </div>
      ) : null}

      <ArtifactLinks artifactUrl={artifactUrl} runs={record.runs} t={t} />
    </div>
  );
}

function ArtifactLinks({
  runs,
  artifactUrl,
  t,
}: {
  runs: EvidenceRun[];
  artifactUrl: (relative: string) => string;
  t: TFunction;
}) {
  const links = runs.flatMap((run) =>
    [
      run.report ? { label: t("issue.evidence.tab.reportLink", { kind: run.kind, repo: run.repo }), relative: run.report } : null,
      run.trace ? { label: t("issue.evidence.tab.traceLink", { kind: run.kind, repo: run.repo }), relative: run.trace } : null,
    ].filter((link): link is { label: string; relative: string } => link !== null),
  );

  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {links.map((link) => (
        <a
          className="text-primary underline-offset-2 hover:underline"
          href={artifactUrl(link.relative)}
          key={`${link.label}-${link.relative}`}
          rel="noreferrer"
          target="_blank"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

function summaryText(run: EvidenceRun, t: TFunction): string {
  const summary = run.summary;
  if (!summary) return "-";

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

  return "-";
}

function StatusPill({ status }: { status: string }) {
  const passed = status === "passed";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        passed
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-red-500/15 text-red-600 dark:text-red-400",
      )}
    >
      {status}
    </span>
  );
}

export type { EvidenceAttention };
