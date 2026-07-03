import { Columns2, Rows3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { GitDiffFileTree } from "@/components/issues/issue-detail/git-diff/GitDiffFileTree";
import { GitDiffViewer } from "@/components/issues/issue-detail/git-diff/GitDiffViewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGitDiff } from "@/hooks/useGitDiff";
import { useIssueCommitEvidence } from "@/hooks/useIssueCommitEvidence";
import { combineDiffStats, diffStatsFromPatch } from "@/lib/diffStats";
import { loadDiffViewMode, saveDiffViewMode, type DiffViewMode } from "@/lib/diffViewMode";
import { cn } from "@/lib/utils";
import { getCommitEvidence } from "@/services/commitEvidence";
import type { CommitEvidenceDetail, CommitEvidenceSummary } from "@/types/commitEvidence";
import type { GitDiffFileChange, GitDiffRepo, GitDiffType } from "@/types/gitDiff";

interface GitDiffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug?: string;
  identifier?: string | null;
  threadId?: number | null;
}

export default function GitDiffModal({ open, onOpenChange, projectSlug = "", identifier = null, threadId = null }: GitDiffModalProps) {
  const { t } = useTranslation();
  const supportsCommits = Boolean(projectSlug && identifier);
  const [activeTab, setActiveTab] = useState<GitDiffType | "commits">("branch");
  const [viewMode, setViewMode] = useState<DiffViewMode>(() => loadDiffViewMode());
  const [flat, setFlat] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedCommitKey, setSelectedCommitKey] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<CommitEvidenceDetail | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);
  const diffType: GitDiffType = activeTab === "uncommitted" ? "uncommitted" : "branch";
  const diff = useGitDiff({ projectSlug, identifier, threadId, type: diffType, enabled: open && activeTab !== "commits" });
  const commits = useIssueCommitEvidence({ projectSlug, identifier, enabled: open && activeTab === "commits" && supportsCommits });
  const selectedCommit =
    commits.commits.find((commit) => commitKey(commit) === selectedCommitKey) ?? commits.commits[0] ?? null;

  const commitFiles = useMemo(
    () => (commitDetail ? commitDetail.files.map((file) => ({ key: fileKey(file), file })) : []),
    [commitDetail],
  );
  const diffFiles = useMemo(() => flattenFiles(diff.repos), [diff.repos]);
  const files = activeTab === "commits" ? commitFiles : diffFiles;
  const selected = files.find((file) => file.key === selectedKey)?.file ?? files[0]?.file ?? null;
  const stats = combineDiffStats(files.map(({ file }) => diffStatsFromPatch(file.patch)));

  function handleViewModeChange(nextMode: DiffViewMode) {
    setViewMode(nextMode);
    saveDiffViewMode(nextMode);
  }

  useEffect(() => {
    setSelectedKey(null);
  }, [activeTab, identifier, selectedCommitKey]);

  useEffect(() => {
    setSelectedCommitKey(null);
    setCommitDetail(null);
  }, [identifier]);

  useEffect(() => {
    if (!open || activeTab !== "commits" || !selectedCommit || !projectSlug || !identifier) return;

    let cancelled = false;
    setCommitLoading(true);
    void getCommitEvidence(projectSlug, identifier, selectedCommit.repo, selectedCommit.sha)
      .then((detail) => {
        if (!cancelled) setCommitDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setCommitDetail(null);
      })
      .finally(() => {
        if (!cancelled) setCommitLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, identifier, open, projectSlug, selectedCommit]);

  useEffect(() => {
    if (activeTab === "commits" && !supportsCommits) setActiveTab("branch");
  }, [activeTab, supportsCommits]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(84vh,760px)] max-w-6xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>{t("issue.diff.title")}</DialogTitle>
          <DialogDescription>
            {(identifier ?? (threadId ? `thread #${threadId}` : ""))} · {diff.workspace?.available ? diff.workspace.path : t("issue.diff.workspaceUnavailable")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as GitDiffType | "commits")}>
            <TabsList>
              <TabsTrigger value="branch">{t("issue.diff.branch")}</TabsTrigger>
              <TabsTrigger value="uncommitted">{t("issue.diff.uncommitted")}</TabsTrigger>
              {supportsCommits ? <TabsTrigger value="commits">{t("issue.diff.commits")}</TabsTrigger> : null}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2 text-xs tabular-nums">
            <span>{t("issue.diff.files", { count: files.length })}</span>
            <span className="text-emerald-600">+{stats.additions}</span>
            <span className="text-rose-600">-{stats.deletions}</span>
            <ViewModeToggle viewMode={viewMode} onChange={handleViewModeChange} />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => (activeTab === "commits" ? void commits.refetch() : void diff.refetch())}
              disabled={activeTab === "commits" ? commits.loading : diff.loading}
            >
              {t("issue.diff.refresh")}
            </Button>
          </div>
        </div>

        {activeTab === "commits" && commits.error ? (
          <p className="border-b px-4 py-2 text-sm text-destructive">{commits.error}</p>
        ) : null}
        {activeTab !== "commits" && diff.error ? <p className="border-b px-4 py-2 text-sm text-destructive">{diff.error}</p> : null}

        <div className="grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-auto border-r">
            {activeTab === "commits" ? (
              <CommitList
                commits={commits.commits}
                selected={selectedCommit}
                onSelect={(commit) => {
                  setSelectedCommitKey(commitKey(commit));
                  setCommitDetail(null);
                }}
              />
            ) : (
              <GitDiffFileTree
                files={files.map((entry) => entry.file)}
                flat={flat}
                selectedPath={selected?.path ?? null}
                onSelect={(file) => setSelectedKey(fileKey(file))}
                onToggleFlat={() => setFlat((current) => !current)}
              />
            )}
          </aside>
          <section className="min-h-0">
            {(activeTab === "commits" ? commits.loading || commitLoading : diff.loading) && files.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("issue.diff.loading")}</div>
            ) : (
              <GitDiffViewer file={selected} viewMode={viewMode} />
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ViewModeToggle({ viewMode, onChange }: { viewMode: DiffViewMode; onChange: (mode: DiffViewMode) => void }) {
  const { t } = useTranslation();

  return (
    <div className="inline-flex overflow-hidden rounded-md border">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn("h-7 gap-1 rounded-r-none px-2 text-xs", viewMode === "split" && "bg-muted")}
        aria-pressed={viewMode === "split"}
        onClick={() => onChange("split")}
      >
        <Columns2 className="h-3.5 w-3.5" />
        {t("issue.diff.viewMode.split")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn("h-7 gap-1 rounded-l-none px-2 text-xs", viewMode === "unified" && "bg-muted")}
        aria-pressed={viewMode === "unified"}
        onClick={() => onChange("unified")}
      >
        <Rows3 className="h-3.5 w-3.5" />
        {t("issue.diff.viewMode.unified")}
      </Button>
    </div>
  );
}

function CommitList({
  commits,
  selected,
  onSelect,
}: {
  commits: CommitEvidenceSummary[];
  selected: CommitEvidenceSummary | null;
  onSelect: (commit: CommitEvidenceSummary) => void;
}) {
  if (commits.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">No commits.</p>;
  }

  return (
    <div className="space-y-1 p-2">
      {commits.map((commit) => {
        const active = selected?.sha === commit.sha;
        return (
          <button
            key={commitKey(commit)}
            type="button"
            onClick={() => onSelect(commit)}
            className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60 ${active ? "bg-muted" : ""}`}
          >
            <div className="truncate font-medium">{commit.message}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono">{commit.shortSha}</span>
              <span>{commit.repo}</span>
              <span className="text-emerald-600">+{commit.insertions}</span>
              <span className="text-rose-600">-{commit.deletions}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function flattenFiles(repos: GitDiffRepo[]): Array<{ key: string; file: GitDiffFileChange }> {
  return repos.flatMap((repo) =>
    repo.files.map((file) => {
      const prefixedFile = prefixFileWithRepo(repo.repo, file);
      return { key: fileKey(prefixedFile), file: prefixedFile };
    }),
  );
}

function fileKey(file: GitDiffFileChange): string {
  return `${file.path}:${file.oldPath ?? ""}`;
}

function prefixFileWithRepo(repo: string, file: GitDiffFileChange): GitDiffFileChange {
  const prefix = repo.trim();
  if (!prefix) return file;
  return {
    ...file,
    path: `${prefix}/${file.path}`,
    oldPath: file.oldPath ? `${prefix}/${file.oldPath}` : null,
  };
}

function commitKey(commit: CommitEvidenceSummary): string {
  return `${commit.repo}:${commit.sha}`;
}
