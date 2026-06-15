import { ClipboardCheck, RefreshCw } from "lucide-react";

import { CommitEvidenceSection } from "@/components/issues/issue-detail/CommitEvidenceSection";
import { ReturnToAgentPanel } from "@/components/issues/issue-detail/ReturnToAgentPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  assessEvidenceAttention,
  evidenceAttentionSummary,
  type EvidenceAttention,
} from "@/lib/evidenceStatus";
import { evidenceArtifactUrl } from "@/services/evidence";
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
  onRefresh: () => void;
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
  const evidenceAttention = assessEvidenceAttention(records);
  const attentionSummary = evidenceAttentionSummary(evidenceAttention);
  const canContinueWork =
    showContinueWork && issue && trackerConfig && evidenceAttention.kind !== "none";

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

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardCheck className="h-4 w-4 opacity-80" />
          Evidence runs
        </div>
        <Button onClick={onRefresh} size="sm" type="button" variant="ghost">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!error && evidenceAttention.kind !== "none" && !canContinueWork ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">{attentionSummary}</p>
      ) : null}

      {!error && records.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading evidence…" : "No evidence captured for this issue yet."}
        </p>
      ) : null}

      {records.map((record) => (
        <EvidenceCard
          key={record.id}
          identifier={identifier}
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
}: {
  projectSlug: string;
  identifier: string;
  record: EvidenceRecord;
}) {
  const artifactUrl = (relative: string) =>
    evidenceArtifactUrl(projectSlug, identifier, record.runId, relative);

  const screenshots = record.runs.flatMap((run) => run.screenshots ?? []);
  const videos = record.runs.flatMap((run) => run.videos ?? []);

  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid={`evidence-${record.runId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={record.status} />
        <span className="font-mono text-xs text-muted-foreground">{record.runId}</span>
        {record.uiChange ? <Badge variant="outline">UI change</Badge> : null}
        {record.insertedAt ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {new Date(record.insertedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {record.runs.length > 0 ? (
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-2 font-medium">Kind</th>
              <th className="py-1 pr-2 font-medium">Repo</th>
              <th className="py-1 pr-2 font-medium">Command</th>
              <th className="py-1 pr-2 font-medium">Status</th>
              <th className="py-1 font-medium">Summary</th>
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
                <td className="py-1.5">{summaryText(run)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {screenshots.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {screenshots.map((relative) => (
            <a href={artifactUrl(relative)} key={relative} rel="noreferrer" target="_blank">
              <img
                alt={relative.split("/").pop() ?? relative}
                className="h-28 w-full rounded border object-cover"
                loading="lazy"
                src={artifactUrl(relative)}
              />
            </a>
          ))}
        </div>
      ) : null}

      {videos.length > 0 ? (
        <div className="space-y-2">
          {videos.map((relative) => (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- agent-captured e2e recordings have no captions
            <video className="w-full rounded border" controls key={relative} src={artifactUrl(relative)} />
          ))}
        </div>
      ) : null}

      <ArtifactLinks artifactUrl={artifactUrl} runs={record.runs} />
    </div>
  );
}

function ArtifactLinks({
  runs,
  artifactUrl,
}: {
  runs: EvidenceRun[];
  artifactUrl: (relative: string) => string;
}) {
  const links = runs.flatMap((run) =>
    [
      run.report ? { label: `${run.kind} report (${run.repo})`, relative: run.report } : null,
      run.trace ? { label: `${run.kind} trace (${run.repo})`, relative: run.trace } : null,
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

function summaryText(run: EvidenceRun): string {
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
    return `${summary.passed}/${summary.total} passed, ${summary.failed} failed`;
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
