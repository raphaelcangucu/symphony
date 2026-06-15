import { GitCommit, RefreshCw } from "lucide-react";
import { useState } from "react";

import { CommitDiffSheet } from "@/components/issues/issue-detail/CommitDiffSheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CommitEvidenceSummary, CommitEvidenceWorkspace } from "@/types/commitEvidence";

interface CommitEvidenceSectionProps {
  projectSlug: string;
  identifier: string;
  commits: CommitEvidenceSummary[];
  workspace: CommitEvidenceWorkspace | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function CommitEvidenceSection({
  projectSlug,
  identifier,
  commits,
  workspace,
  loading,
  error,
  onRefresh,
}: CommitEvidenceSectionProps) {
  const [selectedCommit, setSelectedCommit] = useState<CommitEvidenceSummary | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const openCommit = (commit: CommitEvidenceSummary) => {
    setSelectedCommit(commit);
    setSheetOpen(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GitCommit className="h-4 w-4 opacity-80" />
          Agent commits
        </div>
        <Button onClick={onRefresh} size="sm" type="button" variant="ghost">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!error && workspace && !workspace.available ? (
        <p className="text-sm text-muted-foreground">
          Workspace not available on this machine — commit history cannot be read locally.
        </p>
      ) : null}

      {!error && commits.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading commits…" : "No agent commits ahead of the integration branch yet."}
        </p>
      ) : null}

      {commits.map((commit) => (
        <button
          className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/40"
          data-testid={`commit-evidence-${commit.shortSha}`}
          key={`${commit.repo}-${commit.sha}`}
          onClick={() => openCommit(commit)}
          type="button"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-primary">{commit.shortSha}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{commit.repo}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{commit.message}</span>
            <span className="text-xs text-muted-foreground">{formatDate(commit.authoredAt)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{commit.author}</span>
            <span>
              {commit.filesChanged} file{commit.filesChanged === 1 ? "" : "s"}
            </span>
            <span className="text-emerald-600 dark:text-emerald-400">+{commit.insertions}</span>
            <span className="text-red-600 dark:text-red-400">-{commit.deletions}</span>
          </div>
        </button>
      ))}

      <CommitDiffSheet
        commit={selectedCommit}
        identifier={identifier}
        onOpenChange={setSheetOpen}
        open={sheetOpen}
        projectSlug={projectSlug}
      />
    </div>
  );
}

function formatDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
