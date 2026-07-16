import { Columns2, GitBranch, GitCommitHorizontal, Loader2, MessageSquareText, RefreshCw, Rows3, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { GitDiffFileTree } from "@/components/issues/issue-detail/git-diff/GitDiffFileTree";
import { GitDiffViewer, type SaveDiffCommentInput } from "@/components/issues/issue-detail/git-diff/GitDiffViewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useGitDiffFiles } from "@/hooks/useGitDiffFiles";
import { useGitDiffPatch } from "@/hooks/useGitDiffPatch";
import { useGitDiffStats } from "@/hooks/useGitDiffStats";
import { useIssueCommitEvidence } from "@/hooks/useIssueCommitEvidence";
import {
  buildDiffReviewPrompt,
  newDiffReviewCommentId,
  type CommitNote,
  type DiffReviewComment,
} from "@/lib/diffReview";
import { combineDiffStats, diffStatsFromPatch, type DiffStats } from "@/lib/diffStats";
import { loadDiffViewMode, saveDiffViewMode, type DiffViewMode } from "@/lib/diffViewMode";
import {
  findGitDiffEntriesForPath,
  gitDiffPathBaseName,
  pickBestGitDiffEntry,
} from "@/lib/gitDiffPathMatch";
import { cn } from "@/lib/utils";
import { getCommitEvidence } from "@/services/commitEvidence";
import {
  commitGitDiff,
  commitThreadGitDiff,
  generateCommitMessage,
  getGitDiffSummaries,
  pushGitDiff,
} from "@/services/gitDiff";
import type { CommitEvidenceDetail, CommitEvidenceSummary } from "@/types/commitEvidence";
import type { GitDiffFileChange, GitDiffFileEntry, GitDiffFileTreeEntry, GitDiffRepoStat, GitDiffType } from "@/types/gitDiff";

interface GitDiffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug?: string;
  identifier?: string | null;
  threadId?: number | null;
  /** When set, line comments can be collected on the diff and sent back to the agent as one review prompt. */
  onSendReview?: (review: string) => void;
  initialCommitDialogOpen?: boolean;
  onCommitDialogOpened?: () => void;
  /** When set while open, focus Uncommitted then Branch on this path. */
  initialFocusPath?: string | null;
  onInitialFocusConsumed?: () => void;
  /** When set while open, switch to Commits and select this commit. */
  initialFocusCommit?: { repo: string; sha: string } | null;
  onInitialFocusCommitConsumed?: () => void;
}

type FocusAttemptTab = "uncommitted" | "branch";

/** A file row for the tree/viewer: repo-prefixed display path plus the original repo/path needed to fetch its patch. */
interface DiffFileRow extends GitDiffFileTreeEntry {
  repo: string;
  originalPath: string;
}

const SEARCH_DEBOUNCE_MS = 300;

export default function GitDiffModal({
  open,
  onOpenChange,
  projectSlug = "",
  identifier = null,
  threadId = null,
  onSendReview,
  initialCommitDialogOpen = false,
  onCommitDialogOpened,
  initialFocusPath = null,
  onInitialFocusConsumed,
  initialFocusCommit = null,
  onInitialFocusCommitConsumed,
}: GitDiffModalProps) {
  const { t } = useTranslation();
  const supportsCommits = Boolean(projectSlug && identifier);
  const [activeTab, setActiveTab] = useState<GitDiffType | "commits">("branch");
  const [viewMode, setViewMode] = useState<DiffViewMode>(() => loadDiffViewMode());
  const [flat, setFlat] = useState(false);
  const [activeRepo, setActiveRepo] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedCommitKey, setSelectedCommitKey] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<CommitEvidenceDetail | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitPending, setCommitPending] = useState(false);
  const [generatePending, setGeneratePending] = useState(false);
  const [pushPending, setPushPending] = useState(false);
  const [canPush, setCanPush] = useState(false);
  const [commitDialogError, setCommitDialogError] = useState<string | null>(null);
  const [pendingFocusPath, setPendingFocusPath] = useState<string | null>(null);
  const [focusAttempt, setFocusAttempt] = useState<FocusAttemptTab | null>(null);
  const [pendingSelectKey, setPendingSelectKey] = useState<string | null>(null);
  const focusAttemptReadyKeyRef = useRef<string | null>(null);
  const diffType: GitDiffType = activeTab === "uncommitted" ? "uncommitted" : "branch";
  const diffActive = open && activeTab !== "commits";

  useEffect(() => {
    if (!open || !initialCommitDialogOpen) return;
    setCommitDialogOpen(true);
    onCommitDialogOpened?.();
  }, [initialCommitDialogOpen, onCommitDialogOpened, open]);

  useEffect(() => {
    if (!open) {
      setPendingFocusPath(null);
      setFocusAttempt(null);
      setPendingSelectKey(null);
      return;
    }
    const trimmed = typeof initialFocusPath === "string" ? initialFocusPath.trim() : "";
    if (!trimmed) return;
    const filter = gitDiffPathBaseName(trimmed);
    setPendingFocusPath(trimmed);
    setFocusAttempt("uncommitted");
    setPendingSelectKey(null);
    focusAttemptReadyKeyRef.current = null;
    setActiveRepo("all");
    setActiveTab("uncommitted");
    setQuery(filter);
    setDebouncedQuery(filter);
  }, [initialFocusPath, open]);

  useEffect(() => {
    if (!pendingFocusPath || !focusAttempt) return;
    if (activeTab !== focusAttempt) return;
    const filter = gitDiffPathBaseName(pendingFocusPath);
    setQuery(filter);
    setDebouncedQuery(filter);
  }, [activeTab, focusAttempt, pendingFocusPath]);

  useEffect(() => {
    if (!commitDialogOpen) {
      setCommitDialogError(null);
      return;
    }
    void refreshPushAvailability();
  }, [commitDialogOpen, identifier, projectSlug]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  const repoStats = useGitDiffStats({ projectSlug, identifier, threadId, type: diffType, enabled: diffActive });
  const files = useGitDiffFiles({
    projectSlug,
    identifier,
    threadId,
    type: diffType,
    repo: activeRepo,
    query: debouncedQuery,
    enabled: diffActive,
  });
  const commits = useIssueCommitEvidence({ projectSlug, identifier, enabled: open && activeTab === "commits" && supportsCommits });
  const workspaceInfo = repoStats.workspace ?? commits.workspace;
  const workspaceLabel =
    workspaceInfo?.available === true
      ? workspaceInfo.path
      : workspaceInfo?.available === false
        ? t("issue.diff.workspaceUnavailable")
        : "";
  const selectedCommit =
    commits.commits.find((commit) => commitKey(commit) === selectedCommitKey) ?? commits.commits[0] ?? null;

  const commitFiles = useMemo(
    () =>
      commitDetail
        ? commitDetail.files.map((file) => ({ key: fileKey(file), repo: selectedCommit?.repo ?? null, file }))
        : [],
    [commitDetail, selectedCommit?.repo],
  );
  const diffRows = useMemo(() => toDiffFileRows(files.files), [files.files]);
  const repoNames = useMemo(() => repoStats.stats.map((stat) => stat.repo).filter(Boolean), [repoStats.stats]);
  const patchTarget = activeTab !== "commits" ? diffRows.find((row) => rowKey(row) === selectedKey) ?? diffRows[0] ?? null : null;
  const patch = useGitDiffPatch({
    projectSlug,
    identifier,
    threadId,
    type: diffType,
    repo: patchTarget?.repo ?? null,
    path: patchTarget?.originalPath ?? null,
    enabled: diffActive && patchTarget != null,
  });
  const selectedCommitEntry =
    commitFiles.find((entry) => entry.key === selectedKey) ?? commitFiles[0] ?? null;
  const selectedDisplayPath = activeTab === "commits" ? selectedCommitEntry?.file.path ?? null : patchTarget?.path ?? null;
  // The patch API returns a repo-relative path; swap in the repo-prefixed display path
  // (matching the tree/header) while keeping the fetched patch content and status.
  const viewerFile: GitDiffFileChange | null =
    activeTab === "commits"
      ? selectedCommitEntry?.file ?? null
      : patch.file && patchTarget
        ? { ...patch.file, path: patchTarget.path, oldPath: patchTarget.oldPath }
        : null;
  const fileCount = activeTab === "commits" ? commitFiles.length : files.total;
  const stats = useMemo(() => diffStatsSummary(activeTab, activeRepo, repoStats.stats, commitFiles), [
    activeTab,
    activeRepo,
    repoStats.stats,
    commitFiles,
  ]);
  const statusRepo = useMemo(() => {
    if (activeTab !== "branch") return null;
    const scoped = activeRepo === "all" ? repoStats.stats : repoStats.stats.filter((stat) => stat.repo === activeRepo);
    return scoped.length === 1 ? scoped[0] : null;
  }, [activeRepo, activeTab, repoStats.stats]);
  const diffLoading = files.loading || repoStats.loading;
  const diffError = files.error ?? repoStats.error;
  const showUncommittedEmpty = activeTab === "uncommitted" && !diffLoading && files.total === 0;

  // Review comments and commit notes are keyed by source so the same file
  // path can carry independent annotations across branch/uncommitted/commit tabs.
  const [reviewComments, setReviewComments] = useState<DiffReviewComment[]>([]);
  const [commitNotes, setCommitNotes] = useState<CommitNote[]>([]);
  const reviewEnabled = Boolean(onSendReview);
  const selectedFileComments = useMemo(() => {
    if (!selectedDisplayPath) return [];
    return reviewComments.filter((comment) => {
      if (comment.filePath !== selectedDisplayPath) return false;
      if (activeTab !== "commits") return true;
      return (
        comment.source === "commit" &&
        comment.commitSha === selectedCommit?.sha &&
        comment.commitRepo === selectedCommit?.repo
      );
    });
  }, [activeTab, reviewComments, selectedDisplayPath, selectedCommit]);
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
    if (!selectedDisplayPath) return;
    setReviewComments((current) => {
      if (input.id) {
        return current.map((comment) =>
          comment.id === input.id ? { ...comment, comment: input.comment } : comment,
        );
      }
      const base = {
        id: newDiffReviewCommentId(),
        filePath: selectedDisplayPath,
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

  async function refetchDiff() {
    await Promise.all([files.refetch(), repoStats.refetch()]);
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
      setCanPush(true);
      setCommitDialogOpen(false);
      setCommitMessage("");
      await refetchDiff();
      if (supportsCommits) await commits.refetch();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.diff.commit.failed"));
    } finally {
      setCommitPending(false);
    }
  }

  async function refreshPushAvailability() {
    if (!projectSlug || !identifier) {
      setCanPush(false);
      return;
    }

    try {
      const result = await getGitDiffSummaries(projectSlug, identifier);
      setCanPush(result.summaries.some((summary) => summary.aheadCount > 0));
    } catch {
      setCanPush(false);
    }
  }

  async function generateMessage() {
    if (!projectSlug || !identifier) return;

    setGeneratePending(true);
    setCommitDialogError(null);
    try {
      const message = await generateCommitMessage(projectSlug, identifier);
      setCommitMessage(message);
    } catch (cause) {
      setCommitDialogError(cause instanceof Error ? cause.message : t("issue.diff.commit.generateFailed"));
    } finally {
      setGeneratePending(false);
    }
  }

  async function submitPush() {
    if (!projectSlug || !identifier || !canPush) return;

    setPushPending(true);
    setCommitDialogError(null);
    try {
      const result = await pushGitDiff(projectSlug, identifier);
      const failures = result.results.filter((entry) => !entry.ok);
      const successes = result.results.length - failures.length;

      if (failures.length > 0) {
        const errors = failures.map((entry) => entry.error).filter(Boolean).join(" ");
        toast.error(errors || t("issue.diff.commit.pushFailed"));
      } else {
        toast.success(t("issue.diff.commit.pushSuccess", { count: successes }));
      }
      await refreshPushAvailability();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("issue.diff.commit.pushFailed");
      setCommitDialogError(message);
      toast.error(message);
    } finally {
      setPushPending(false);
    }
  }

  useEffect(() => {
    // Skip while focus resolution is still pinning a selection; do not list the
    // pending flags in deps or clearing them would wipe the focused file.
    if (pendingFocusPath || pendingSelectKey) return;
    setSelectedKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional guard-only reads
  }, [activeRepo, activeTab, identifier, selectedCommitKey, debouncedQuery]);

  useEffect(() => {
    setSelectedCommitKey(null);
    setCommitDetail(null);
  }, [identifier]);

  // After the identifier reset above — same mount must not wipe focusCommit selection.
  useEffect(() => {
    if (!open) return;
    const repo = typeof initialFocusCommit?.repo === "string" ? initialFocusCommit.repo.trim() : "";
    const sha = typeof initialFocusCommit?.sha === "string" ? initialFocusCommit.sha.trim() : "";
    if (!repo || !sha) return;
    if (!supportsCommits) {
      onInitialFocusCommitConsumed?.();
      return;
    }
    setActiveTab("commits");
    setSelectedCommitKey(`${repo}:${sha}`);
    onInitialFocusCommitConsumed?.();
  }, [initialFocusCommit, open, onInitialFocusCommitConsumed, supportsCommits]);

  useEffect(() => {
    // Only reset the filter when the user changes tab/issue. Do NOT list
    // pendingFocusPath in deps — clearing it after a successful chip focus
    // used to wipe the basename filter, reload all files, and drop selection.
    if (pendingFocusPath) return;
    setQuery("");
    setDebouncedQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pendingFocusPath is guard-only
  }, [activeTab, identifier]);

  useEffect(() => {
    if (!open || !pendingFocusPath || !focusAttempt) return;
    if (activeTab !== focusAttempt) return;

    const attemptKey = `${focusAttempt}\0${debouncedQuery}`;
    if (files.loading) {
      focusAttemptReadyKeyRef.current = attemptKey;
      return;
    }

    const matches = findGitDiffEntriesForPath(files.files, pendingFocusPath);
    const best = pickBestGitDiffEntry(files.files, pendingFocusPath);

    if (best) {
      const key = rowKey({ repo: best.repo, originalPath: best.path });
      setPendingSelectKey(key);
      setSelectedKey(key);
      if (matches.length > 1) {
        toast.message(t("issue.diff.focus.ambiguous", { path: pendingFocusPath }));
      }
      setPendingFocusPath(null);
      setFocusAttempt(null);
      focusAttemptReadyKeyRef.current = null;
      // Keep the basename filter so the focused file stays in the loaded page.
      // Clearing it reloads the full paginated list and drops files beyond page 1.
      onInitialFocusConsumed?.();
      return;
    }

    // Empty list before the fetch for this tab/query has completed — do not
    // treat a stale prior result as definitive (uncommitted → branch race).
    if (focusAttemptReadyKeyRef.current !== attemptKey) {
      return;
    }

    if (focusAttempt === "uncommitted") {
      focusAttemptReadyKeyRef.current = null;
      setFocusAttempt("branch");
      setActiveTab("branch");
      return;
    }

    toast.message(t("issue.diff.focus.notFound", { path: pendingFocusPath }));
    setPendingFocusPath(null);
    setFocusAttempt(null);
    focusAttemptReadyKeyRef.current = null;
    setQuery("");
    setDebouncedQuery("");
    onInitialFocusConsumed?.();
  }, [
    activeTab,
    debouncedQuery,
    files.files,
    files.loading,
    focusAttempt,
    onInitialFocusConsumed,
    open,
    pendingFocusPath,
    t,
  ]);

  useEffect(() => {
    if (!pendingSelectKey) return;
    if (files.loading) return;
    // Keep the pin while the basename filter is still active. Only release after
    // the full (unfiltered) list reload confirms the focused file is present —
    // otherwise clearing the filter drops selection onto the first tree file.
    if (debouncedQuery.trim().length > 0) {
      setSelectedKey(pendingSelectKey);
      return;
    }
    const exists = diffRows.some((row) => rowKey(row) === pendingSelectKey);
    if (!exists) return;
    setSelectedKey(pendingSelectKey);
    setPendingSelectKey(null);
  }, [debouncedQuery, diffRows, files.loading, pendingSelectKey]);

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
            {[identifier ?? (threadId ? `thread #${threadId}` : ""), workspaceLabel].filter(Boolean).join(" · ")}
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
            <span className="text-[11px] text-muted-foreground">{t("issue.diff.files", { count: fileCount })}</span>
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
              onClick={() => (activeTab === "commits" ? void commits.refetch() : void refetchDiff())}
              disabled={activeTab === "commits" ? commits.loading : diffLoading}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("issue.diff.refresh")}
            </Button>
          </div>
        </div>

        {activeTab === "commits" && commits.error ? (
          <p className="border-b px-4 py-2 text-sm text-destructive">{commits.error}</p>
        ) : null}
        {activeTab !== "commits" && diffError ? <p className="border-b px-4 py-2 text-sm text-destructive">{diffError}</p> : null}
        {activeTab !== "commits" && repoNames.length > 1 ? (
          <RepoNav repos={repoNames} activeRepo={activeRepo} onChange={setActiveRepo} />
        ) : null}
        {activeTab === "branch" ? <BranchStatusStrip repo={statusRepo} fileCount={fileCount} stats={stats} /> : null}
        {activeTab === "uncommitted" ? (
          <UncommittedSummaryStrip fileCount={fileCount} stats={stats} reviewCount={uncommittedReviewCount} />
        ) : null}

        {showUncommittedEmpty ? (
          <UncommittedEmptyState onRefresh={() => void refetchDiff()} onViewBranch={() => setActiveTab("branch")} />
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)] bg-background">
            <aside className="flex min-h-0 flex-col overflow-hidden border-r">
              {activeTab === "commits" ? (
                <div className="flex min-h-0 flex-1 flex-col">
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
                  {commits.hasMore ? (
                    <div className="border-t p-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 w-full gap-1 text-[11px]"
                        disabled={commits.loadingMore}
                        onClick={() => void commits.loadMore()}
                      >
                        {commits.loadingMore ? t("issue.diff.loading") : t("issue.diff.loadMore")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <GitDiffFileTree
                    files={diffRows}
                    flat={flat}
                    selectedPath={patchTarget?.path ?? null}
                    onSelect={(file) => setSelectedKey(rowKey(file as DiffFileRow))}
                    onToggleFlat={() => setFlat((current) => !current)}
                    commentCountsByPath={commentCountsByPath}
                    query={query}
                    onQueryChange={setQuery}
                  />
                  {files.hasMore ? (
                    <div className="border-t p-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 w-full gap-1 text-[11px]"
                        disabled={files.loadingMore}
                        onClick={() => void files.loadMore()}
                      >
                        {files.loadingMore ? t("issue.diff.loading") : t("issue.diff.loadMore")}
                      </Button>
                    </div>
                  ) : null}
                </div>
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
                {(activeTab === "commits" ? commits.loading || commitLoading : diffLoading) && fileCount === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("issue.diff.loading")}</div>
                ) : activeTab !== "commits" && patchTarget && patch.loading ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("issue.diff.loading")}</div>
                ) : (
                  <GitDiffViewer
                    file={viewerFile}
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
        <div className="relative space-y-2">
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-8 h-7 w-7"
            aria-label={t("issue.diff.commit.generate")}
            disabled={generatePending || !identifier}
            onClick={() => void generateMessage()}
          >
            {generatePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          </Button>
          {commitDialogError ? <p className="text-xs text-destructive">{commitDialogError}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setCommitDialogOpen(false)} disabled={commitPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!identifier || !canPush || pushPending}
            onClick={() => void submitPush()}
          >
            {pushPending ? t("issue.diff.commit.pushing") : t("issue.diff.commit.push")}
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
  repo: GitDiffRepoStat | null;
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
  const { t } = useTranslation();
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
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">{commit.shortSha}</span>
                    <span className="truncate">{commit.repo}</span>
                    <span
                      className={cn(
                        "rounded px-1 py-px font-medium",
                        commit.online
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {commit.online ? t("issue.commits.online") : t("issue.commits.local")}
                    </span>
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

function diffStatsSummary(
  activeTab: GitDiffType | "commits",
  activeRepo: string,
  stats: GitDiffRepoStat[],
  commitFiles: Array<{ file: GitDiffFileChange }>,
): DiffStats {
  if (activeTab === "commits") {
    return combineDiffStats(commitFiles.map(({ file }) => diffStatsFromPatch(file.patch)));
  }
  const scoped = activeRepo === "all" ? stats : stats.filter((stat) => stat.repo === activeRepo);
  return combineDiffStats(scoped.map((stat) => ({ additions: stat.additions, deletions: stat.deletions })));
}

function toDiffFileRows(files: GitDiffFileEntry[]): DiffFileRow[] {
  return files.map((file) => {
    const prefix = file.repo.trim() ? `${file.repo}/` : "";
    return {
      repo: file.repo,
      originalPath: file.path,
      path: `${prefix}${file.path}`,
      oldPath: file.oldPath ? `${prefix}${file.oldPath}` : null,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      binary: file.binary,
    };
  });
}

function rowKey(row: { repo: string; originalPath: string }): string {
  return `${row.repo}:${row.originalPath}`;
}

function fileKey(file: GitDiffFileChange): string {
  return `${file.path}:${file.oldPath ?? ""}`;
}

function commitKey(commit: CommitEvidenceSummary): string {
  return `${commit.repo}:${commit.sha}`;
}
