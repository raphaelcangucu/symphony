import { Columns2, GitBranch, GitCommitHorizontal, MessageSquareText, RefreshCw, Rows3, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { GitDiffFileTree } from "@/components/issues/issue-detail/git-diff/GitDiffFileTree";
import { GitDiffViewer, type SaveDiffCommentInput } from "@/components/issues/issue-detail/git-diff/GitDiffViewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useGitDiff } from "@/hooks/useGitDiff";
import { useIssueCommitEvidence } from "@/hooks/useIssueCommitEvidence";
import {
  buildDiffReviewPrompt,
  newDiffReviewCommentId,
  type CommitNote,
  type DiffReviewComment,
} from "@/lib/diffReview";
import { combineDiffStats, diffStatsFromPatch, type DiffStats } from "@/lib/diffStats";
import { loadDiffViewMode, saveDiffViewMode, type DiffViewMode } from "@/lib/diffViewMode";
import { cn } from "@/lib/utils";
import { getCommitEvidence } from "@/services/commitEvidence";
import { commitGitDiff, commitThreadGitDiff } from "@/services/gitDiff";
import type { CommitEvidenceDetail, CommitEvidenceSummary } from "@/types/commitEvidence";
import type { GitDiffFileChange, GitDiffRepo, GitDiffType } from "@/types/gitDiff";

interface GitDiffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug?: string;
  identifier?: string | null;
  threadId?: number | null;
  /** When set, line comments can be collected on the diff and sent back to the agent as one review prompt. */
  onSendReview?: (review: string) => void;
}

export default function GitDiffModal({
  open,
  onOpenChange,
  projectSlug = "",
  identifier = null,
  threadId = null,
  onSendReview,
}: GitDiffModalProps) {
  const { t } = useTranslation();
  const supportsCommits = Boolean(projectSlug && identifier);
  const [activeTab, setActiveTab] = useState<GitDiffType | "commits">("branch");
  const [viewMode, setViewMode] = useState<DiffViewMode>(() => loadDiffViewMode());
  const [flat, setFlat] = useState(false);
  const [activeRepo, setActiveRepo] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedCommitKey, setSelectedCommitKey] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<CommitEvidenceDetail | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitPending, setCommitPending] = useState(false);
  const diffType: GitDiffType = activeTab === "uncommitted" ? "uncommitted" : "branch";
  const diff = useGitDiff({ projectSlug, identifier, threadId, type: diffType, enabled: open && activeTab !== "commits" });
  const commits = useIssueCommitEvidence({ projectSlug, identifier, enabled: open && activeTab === "commits" && supportsCommits });
  const selectedCommit =
    commits.commits.find((commit) => commitKey(commit) === selectedCommitKey) ?? commits.commits[0] ?? null;

  const commitFiles = useMemo(
    () =>
      commitDetail
        ? commitDetail.files.map((file) => ({ key: fileKey(file), repo: selectedCommit?.repo ?? null, file }))
        : [],
    [commitDetail, selectedCommit?.repo],
  );
  const diffFiles = useMemo(() => flattenFiles(diff.repos), [diff.repos]);
  const repoNames = useMemo(
    () => [...new Set(diffFiles.map((entry) => entry.repo).filter((repo): repo is string => Boolean(repo)))],
    [diffFiles],
  );
  const repoScopedDiffFiles = useMemo(
    () => (activeRepo === "all" ? diffFiles : diffFiles.filter((entry) => entry.repo === activeRepo)),
    [activeRepo, diffFiles],
  );
  const files = activeTab === "commits" ? commitFiles : repoScopedDiffFiles;
  const selected = files.find((file) => file.key === selectedKey)?.file ?? files[0]?.file ?? null;
  const stats = combineDiffStats(files.map(({ file }) => diffStatsFromPatch(file.patch)));
  const statusRepo = useMemo(() => {
    if (activeTab !== "branch") return null;
    const scoped = activeRepo === "all" ? diff.repos : diff.repos.filter((repo) => repo.repo === activeRepo);
    return scoped.length === 1 ? scoped[0] : null;
  }, [activeRepo, activeTab, diff.repos]);
  const showUncommittedEmpty = activeTab === "uncommitted" && !diff.loading && files.length === 0;

  // Review comments and commit notes are keyed by source so the same file
  // path can carry independent annotations across branch/uncommitted/commit tabs.
  const [reviewComments, setReviewComments] = useState<DiffReviewComment[]>([]);
  const [commitNotes, setCommitNotes] = useState<CommitNote[]>([]);
  const reviewEnabled = Boolean(onSendReview);
  const selectedFileComments = useMemo(() => {
    if (!selected) return [];
    return reviewComments.filter((comment) => {
      if (comment.filePath !== selected.path) return false;
      if (activeTab !== "commits") return true;
      return (
        comment.source === "commit" &&
        comment.commitSha === selectedCommit?.sha &&
        comment.commitRepo === selectedCommit?.repo
      );
    });
  }, [activeTab, reviewComments, selected, selectedCommit]);
  const selectedCommitNote =
    selectedCommit?.repo && selectedCommit?.sha
      ? commitNotes.find((note) => note.repo === selectedCommit.repo && note.sha === selectedCommit.sha)
      : undefined;
  const commentCountsByCommitKey = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const comment of reviewComments) {
      if (comment.source !== "commit" || !comment.commitRepo || !comment.commitSha) continue;
      const key = `${comment.commitRepo}:${comment.commitSha}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [reviewComments]);
  const commentCountsByPath = useMemo(() => {
    if (activeTab !== "branch" && activeTab !== "uncommitted") return undefined;
    const counts: Record<string, number> = {};
    for (const comment of reviewComments) {
      if (comment.source !== activeTab) continue;
      counts[comment.filePath] = (counts[comment.filePath] ?? 0) + 1;
    }
    return counts;
  }, [activeTab, reviewComments]);
  const uncommittedReviewCount = useMemo(
    () => reviewComments.filter((comment) => comment.source === "uncommitted").length,
    [reviewComments],
  );

  function saveReviewComment(input: SaveDiffCommentInput) {
    if (!selected) return;
    setReviewComments((current) => {
      if (input.id) {
        return current.map((comment) =>
          comment.id === input.id ? { ...comment, comment: input.comment } : comment,
        );
      }
      const base = {
        id: newDiffReviewCommentId(),
        filePath: selected.path,
        side: input.side,
        lineNumber: input.lineNumber,
        lineText: input.lineText,
        comment: input.comment,
      };
      const next: DiffReviewComment =
        activeTab === "commits" && selectedCommit
          ? { ...base, source: "commit", commitSha: selectedCommit.sha, commitRepo: selectedCommit.repo }
          : activeTab === "uncommitted"
            ? { ...base, source: "uncommitted" }
            : { ...base, source: "branch" };
      return [...current, next];
    });
  }

  function removeReviewComment(id: string) {
    setReviewComments((current) => current.filter((comment) => comment.id !== id));
  }

  function updateCommitNote(text: string) {
    if (!selectedCommit) return;
    const { repo, sha, shortSha, message } = selectedCommit;
    setCommitNotes((current) => {
      const existing = current.find((note) => note.repo === repo && note.sha === sha);
      if (existing) {
        return current.map((note) => (note.repo === repo && note.sha === sha ? { ...note, note: text } : note));
      }
      return [...current, { repo, sha, shortSha, message, note: text }];
    });
  }

  function sendReviewToAgent() {
    const hasNotes = commitNotes.some((note) => note.note.trim().length > 0);
    if (!onSendReview || (reviewComments.length === 0 && !hasNotes)) return;
    const count = reviewComments.length + commitNotes.filter((note) => note.note.trim().length > 0).length;
    onSendReview(buildDiffReviewPrompt(reviewComments, commitNotes));
    toast.success(t("issue.diff.review.sent", { count }));
    setReviewComments([]);
    setCommitNotes([]);
    onOpenChange(false);
  }

  function handleViewModeChange(nextMode: DiffViewMode) {
    setViewMode(nextMode);
    saveDiffViewMode(nextMode);
  }

  function handleCommitClick() {
    setCommitDialogOpen(true);
  }

  async function submitCommit() {
    const message = commitMessage.trim();
    if (!message) return;
    setCommitPending(true);
    try {
      const result = threadId
        ? await commitThreadGitDiff(threadId, message)
        : await commitGitDiff(projectSlug, identifier ?? "", message);

      toast.success(t("issue.diff.commit.success", { count: result.commits.length }));
      setCommitDialogOpen(false);
      setCommitMessage("");
      await diff.refetch();
      if (supportsCommits) await commits.refetch();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.diff.commit.failed"));
    } finally {
      setCommitPending(false);
    }
  }

  useEffect(() => {
    setSelectedKey(null);
  }, [activeRepo, activeTab, identifier, selectedCommitKey]);

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

  useEffect(() => {
    if (activeRepo !== "all" && !repoNames.includes(activeRepo)) setActiveRepo("all");
  }, [activeRepo, repoNames]);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92vh,840px)] w-[calc(100vw-2rem)] max-w-[1200px] flex-col gap-0 overflow-hidden border-border/80 bg-background p-0 shadow-2xl">
        <DialogHeader className="min-h-11 border-b bg-background px-3 py-2">
          <DialogTitle className="text-sm font-semibold">{t("issue.diff.title")}</DialogTitle>
          <DialogDescription className="truncate text-[11px]">
            {(identifier ?? (threadId ? `thread #${threadId}` : ""))} · {diff.workspace?.available ? diff.workspace.path : t("issue.diff.workspaceUnavailable")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-10 items-center justify-between gap-3 border-b bg-muted/20 px-2">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as GitDiffType | "commits")}>
            <TabsList className="h-7 rounded-md bg-background p-0.5">
              <TabsTrigger value="branch" className="h-6 gap-1 px-2 text-[11px]">
                <GitBranch className="h-3.5 w-3.5" />
                {t("issue.diff.branch")}
              </TabsTrigger>
              <TabsTrigger value="uncommitted" className="h-6 gap-1 px-2 text-[11px]">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {t("issue.diff.uncommitted")}
              </TabsTrigger>
              {supportsCommits ? (
                <TabsTrigger value="commits" className="h-6 gap-1 px-2 text-[11px]">
                  <GitCommitHorizontal className="h-3.5 w-3.5" />
                  {t("issue.diff.commits")}
                </TabsTrigger>
              ) : null}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2 text-xs tabular-nums">
            <span className="text-[11px] text-muted-foreground">{t("issue.diff.files", { count: files.length })}</span>
            <span className="text-[11px] text-emerald-600">+{stats.additions}</span>
            <span className="text-[11px] text-rose-600">-{stats.deletions}</span>
            <ViewModeToggle viewMode={viewMode} onChange={handleViewModeChange} />
            {reviewEnabled && reviewComments.length + commitNotes.filter((note) => note.note.trim()).length > 0 ? (
              <Button
                type="button"
                size="sm"
                className="h-7 gap-1 rounded-md bg-sky-600 px-2 text-[11px] text-white hover:bg-sky-500"
                onClick={sendReviewToAgent}
              >
                <MessageSquareText className="h-3.5 w-3.5" />
                {t("issue.diff.review.sendButton", {
                  count: reviewComments.length + commitNotes.filter((note) => note.note.trim()).length,
                })}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1 rounded-md bg-slate-950 px-2 text-[11px] text-white hover:bg-slate-800"
              title={t("issue.diff.commit.title")}
              disabled={!threadId && (!projectSlug || !identifier)}
              onClick={handleCommitClick}
            >
              <GitCommitHorizontal className="h-3.5 w-3.5" />
              {t("issue.diff.commit.button")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => (activeTab === "commits" ? void commits.refetch() : void diff.refetch())}
              disabled={activeTab === "commits" ? commits.loading : diff.loading}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("issue.diff.refresh")}
            </Button>
          </div>
        </div>

        {activeTab === "commits" && commits.error ? (
          <p className="border-b px-4 py-2 text-sm text-destructive">{commits.error}</p>
        ) : null}
        {activeTab !== "commits" && diff.error ? <p className="border-b px-4 py-2 text-sm text-destructive">{diff.error}</p> : null}
        {activeTab !== "commits" && repoNames.length > 1 ? (
          <RepoNav repos={repoNames} activeRepo={activeRepo} onChange={setActiveRepo} />
        ) : null}
        {activeTab === "branch" ? <BranchStatusStrip repo={statusRepo} fileCount={files.length} stats={stats} /> : null}
        {activeTab === "uncommitted" ? (
          <UncommittedSummaryStrip fileCount={files.length} stats={stats} reviewCount={uncommittedReviewCount} />
        ) : null}

        {showUncommittedEmpty ? (
          <UncommittedEmptyState onRefresh={() => void diff.refetch()} onViewBranch={() => setActiveTab("branch")} />
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)] bg-background">
            <aside className="min-h-0 overflow-hidden border-r">
              {activeTab === "commits" ? (
                <CommitList
                  commits={commits.commits}
                  selected={selectedCommit}
                  commitNotes={commitNotes}
                  commentCountsByCommitKey={commentCountsByCommitKey}
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
                  commentCountsByPath={commentCountsByPath}
                />
              )}
            </aside>
            <section className="flex min-h-0 flex-col overflow-hidden">
              {activeTab === "commits" && selectedCommit ? (
                <div className="shrink-0 border-b bg-muted/10 px-3 py-2">
                  <label className="text-[11px] font-medium text-muted-foreground" htmlFor="workspace-commit-note">
                    {t("issue.diff.commitNote.label")}
                  </label>
                  <Textarea
                    id="workspace-commit-note"
                    value={selectedCommitNote?.note ?? ""}
                    onChange={(event) => updateCommitNote(event.target.value)}
                    placeholder={t("issue.diff.commitNote.placeholder")}
                    className="mt-1 min-h-14 text-xs"
                  />
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-hidden">
                {(activeTab === "commits" ? commits.loading || commitLoading : diff.loading) && files.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("issue.diff.loading")}</div>
                ) : (
                  <GitDiffViewer
                    file={selected}
                    viewMode={viewMode}
                    comments={reviewEnabled ? selectedFileComments : undefined}
                    onSaveComment={reviewEnabled ? saveReviewComment : undefined}
                    onRemoveComment={reviewEnabled ? removeReviewComment : undefined}
                  />
                )}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
    <Dialog open={commitDialogOpen} onOpenChange={setCommitDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("issue.diff.commit.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("issue.diff.commit.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="workspace-commit-message">
            {t("issue.diff.commit.messageLabel")}
          </label>
          <Textarea
            id="workspace-commit-message"
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder={t("issue.diff.commit.messagePlaceholder")}
            className="min-h-24 font-mono text-xs"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setCommitDialogOpen(false)} disabled={commitPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={() => void submitCommit()} disabled={commitPending || !commitMessage.trim()}>
            {commitPending ? t("issue.diff.commit.committing") : t("issue.diff.commit.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function ViewModeToggle({ viewMode, onChange }: { viewMode: DiffViewMode; onChange: (mode: DiffViewMode) => void }) {
  const { t } = useTranslation();

  return (
    <div className="inline-flex overflow-hidden rounded-md border bg-background">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn("h-7 gap-1 rounded-r-none px-2 text-[11px]", viewMode === "split" && "bg-muted")}
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
        className={cn("h-7 gap-1 rounded-l-none px-2 text-[11px]", viewMode === "unified" && "bg-muted")}
        aria-pressed={viewMode === "unified"}
        onClick={() => onChange("unified")}
      >
        <Rows3 className="h-3.5 w-3.5" />
        {t("issue.diff.viewMode.unified")}
      </Button>
    </div>
  );
}

function RepoNav({ repos, activeRepo, onChange }: { repos: string[]; activeRepo: string; onChange: (repo: string) => void }) {
  const { t } = useTranslation();

  return (
    <div className="flex h-9 items-center gap-1 overflow-x-auto border-b bg-background px-2">
      <button
        type="button"
        className={cn(
          "inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] text-muted-foreground hover:bg-muted",
          activeRepo === "all" && "bg-muted text-foreground",
        )}
        onClick={() => onChange("all")}
      >
        {t("issue.diff.repos.all")}
      </button>
      {repos.map((repo) => (
        <button
          key={repo}
          type="button"
          className={cn(
            "inline-flex h-6 shrink-0 items-center rounded-full border px-2 font-mono text-[11px] text-muted-foreground hover:bg-muted",
            activeRepo === repo && "bg-muted text-foreground",
          )}
          onClick={() => onChange(repo)}
        >
          {repo}
        </button>
      ))}
    </div>
  );
}

function BranchStatusStrip({
  repo,
  fileCount,
  stats,
}: {
  repo: GitDiffRepo | null;
  fileCount: number;
  stats: DiffStats;
}) {
  const { t } = useTranslation();
  const hasBranch = Boolean(repo?.branch);

  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-b bg-muted/10 px-3 text-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {hasBranch ? (
          <span className="truncate font-mono">
            {t("issue.diff.status.branchBase", { branch: repo!.branch, base: repo!.base ?? "—" })}
          </span>
        ) : (
          <span className="truncate text-muted-foreground">{t("issue.diff.status.branchUnknown")}</span>
        )}
        {hasBranch ? (
          <span className="truncate text-muted-foreground">
            {repo!.behind === null || repo!.behind === undefined
              ? t("issue.diff.status.aheadBehindUnknown", { ahead: repo!.ahead ?? 0 })
              : t("issue.diff.status.aheadBehind", { ahead: repo!.ahead ?? 0, behind: repo!.behind })}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 tabular-nums">
        <span className="text-muted-foreground">{t("issue.diff.files", { count: fileCount })}</span>
        <span className="text-emerald-600">+{stats.additions}</span>
        <span className="text-rose-600">-{stats.deletions}</span>
      </div>
    </div>
  );
}

function UncommittedSummaryStrip({
  fileCount,
  stats,
  reviewCount,
}: {
  fileCount: number;
  stats: DiffStats;
  reviewCount: number;
}) {
  const { t } = useTranslation();

  return (
    <div
      data-testid="uncommitted-summary-strip"
      className="flex h-8 shrink-0 items-center justify-between gap-3 border-b bg-muted/10 px-3 text-[11px]"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
        <span className="truncate font-medium">{t("issue.diff.status.workingTree")}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2 tabular-nums">
        <span className="text-muted-foreground">{t("issue.diff.files", { count: fileCount })}</span>
        <span className="text-emerald-600">+{stats.additions}</span>
        <span className="text-rose-600">-{stats.deletions}</span>
        {reviewCount > 0 ? (
          <span className="text-sky-600">{t("issue.diff.status.reviewCount", { count: reviewCount })}</span>
        ) : null}
      </div>
    </div>
  );
}

function UncommittedEmptyState({
  onRefresh,
  onViewBranch,
}: {
  onRefresh: () => void;
  onViewBranch: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background p-8 text-center">
      <p className="text-sm font-medium text-foreground">{t("issue.diff.empty.uncommittedTitle")}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{t("issue.diff.empty.uncommittedBody")}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          data-testid="uncommitted-empty-refresh"
          onClick={onRefresh}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("issue.diff.empty.refresh")}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1 rounded-md bg-slate-950 px-2 text-[11px] text-white hover:bg-slate-800"
          onClick={onViewBranch}
        >
          <GitBranch className="h-3.5 w-3.5" />
          {t("issue.diff.empty.viewBranch")}
        </Button>
      </div>
    </div>
  );
}

function CommitList({
  commits,
  selected,
  commitNotes = [],
  commentCountsByCommitKey = {},
  onSelect,
}: {
  commits: CommitEvidenceSummary[];
  selected: CommitEvidenceSummary | null;
  commitNotes?: CommitNote[];
  commentCountsByCommitKey?: Record<string, number>;
  onSelect: (commit: CommitEvidenceSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCommits = normalizedQuery
    ? commits.filter((commit) =>
        [commit.message, commit.repo, commit.sha, commit.shortSha].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        ),
      )
    : commits;

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/15">
      <div className="border-b px-2 py-1.5">
        <div className="flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-muted-foreground">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter commits..."
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto p-1.5">
        {filteredCommits.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">No commits.</p>
        ) : (
          filteredCommits.map((commit) => {
            const active = selected !== null && commitKey(commit) === commitKey(selected);
            const key = commitKey(commit);
            const note = commitNotes.find((entry) => entry.repo === commit.repo && entry.sha === commit.sha);
            const commentCount = commentCountsByCommitKey[key] ?? 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(commit)}
                className={cn(
                  "flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-background",
                  active && "bg-background shadow-sm ring-1 ring-border",
                )}
              >
                <GitCommitHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium">{commit.message}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">{commit.shortSha}</span>
                    <span className="truncate">{commit.repo}</span>
                    <span className="text-emerald-600">+{commit.insertions}</span>
                    <span className="text-rose-600">-{commit.deletions}</span>
                    {note?.note.trim() ? <span title={note.note}>📝</span> : null}
                    {commentCount > 0 ? <span>💬{commentCount}</span> : null}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function flattenFiles(repos: GitDiffRepo[]): Array<{ key: string; repo: string | null; file: GitDiffFileChange }> {
  return repos.flatMap((repo) =>
    repo.files.map((file) => {
      const prefixedFile = prefixFileWithRepo(repo.repo, file);
      return { key: fileKey(prefixedFile), repo: repo.repo || null, file: prefixedFile };
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
