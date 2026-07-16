import { GitBranch, GitCommitHorizontal, GitCompare, HardDrive, PanelRight, X } from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { GitDiffLauncher } from "@/components/issues/issue-detail/git-diff/GitDiffLauncher";
import { PullRequestLink } from "@/components/issues/pull-request/PullRequestLink";
import { Button } from "@/components/ui/button";
import { useHorizontalPanelResize } from "@/hooks/useHorizontalPanelResize";
import { useIssueCommitEvidence } from "@/hooks/useIssueCommitEvidence";
import { useIssuePullRequests } from "@/hooks/useIssuePullRequests";
import { useWorkspaceDiffStats } from "@/hooks/useWorkspaceDiffStats";
import { useWorkspaceRepoSummaries } from "@/hooks/useWorkspaceRepoSummaries";
import { cn } from "@/lib/utils";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import { getIssue } from "@/services/issues";

const ENVIRONMENT_DOCK_WIDTH_STORAGE_KEY = "symphony:issue-environment-dock-width";
const ENVIRONMENT_DOCK_DEFAULT_WIDTH = 280;
const ENVIRONMENT_DOCK_MIN_WIDTH = 240;
const RECENT_COMMITS_LIMIT = 3;

interface IssueEnvironmentDockProps {
  projectSlug: string;
  issueIdentifier: string;
  view: WorkspaceView;
  splitContainerRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

export function IssueEnvironmentDock({
  projectSlug,
  issueIdentifier,
  splitContainerRef,
  onClose,
}: IssueEnvironmentDockProps) {
  const { t } = useTranslation();
  const [compareRequestId, setCompareRequestId] = useState(0);
  const [commitRequestId, setCommitRequestId] = useState(0);
  const [issueBranch, setIssueBranch] = useState<string | null>(null);
  const diffStats = useWorkspaceDiffStats({
    projectSlug,
    issueIdentifier,
    enabled: true,
  });
  const workspaceSummaries = useWorkspaceRepoSummaries({
    projectSlug,
    issueIdentifier,
    enabled: true,
  });
  const pullRequestResult = useIssuePullRequests({
    projectSlug,
    identifier: issueIdentifier,
    enabled: true,
  });
  const recentCommits = useIssueCommitEvidence({
    projectSlug,
    identifier: issueIdentifier,
    enabled: true,
    limit: RECENT_COMMITS_LIMIT,
  });
  const { width, isResizing, onResizePointerDown, onResizePointerUp } = useHorizontalPanelResize({
    containerRef: splitContainerRef,
    storageKey: ENVIRONMENT_DOCK_WIDTH_STORAGE_KEY,
    defaultWidth: ENVIRONMENT_DOCK_DEFAULT_WIDTH,
    minWidth: ENVIRONMENT_DOCK_MIN_WIDTH,
  });

  useEffect(() => {
    let current = true;
    setIssueBranch(null);

    void getIssue(projectSlug, issueIdentifier)
      .then((issue) => {
        if (current) setIssueBranch(issue.branchName);
      })
      .catch(() => {
        if (current) setIssueBranch(null);
      });

    return () => {
      current = false;
    };
  }, [issueIdentifier, projectSlug]);

  const openCompare = useCallback(() => {
    setCompareRequestId((current) => current + 1);
  }, []);

  const openCommitPush = useCallback(() => {
    setCommitRequestId((current) => current + 1);
  }, []);

  const additions = diffStats?.additions ?? 0;
  const deletions = diffStats?.deletions ?? 0;
  const linkedPullRequests = useMemo(() => {
    const ownUrls = new Set(
      pullRequestResult.pullRequests.map((pullRequest) => pullRequest.url).filter((url): url is string => Boolean(url)),
    );
    const childPullRequests = pullRequestResult.children
      .flatMap((group) => group.pullRequests)
      .filter((pullRequest) => !pullRequest.url || !ownUrls.has(pullRequest.url));

    return [...pullRequestResult.pullRequests, ...childPullRequests];
  }, [pullRequestResult.children, pullRequestResult.pullRequests]);
  const localBranch = workspaceSummaries.localBranch;

  return (
    <aside
      data-testid="environment-dock"
      className={cn(
        "relative flex min-h-0 shrink-0 flex-col overflow-hidden pl-1.5",
        isResizing && "select-none",
      )}
      style={{ width: `${width}px`, maxWidth: "75%" }}
    >
      <button
        type="button"
        aria-label={t("workspace.environment.resizeHandleAria")}
        title={t("workspace.environment.resizeHandleAria")}
        className="group absolute inset-y-0 left-0 z-10 flex w-3 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
        onPointerDown={onResizePointerDown}
        onPointerUp={onResizePointerUp}
      >
        <span
          aria-hidden
          className={cn(
            "h-full w-[3px] rounded-full transition-colors",
            isResizing ? "bg-primary/60" : "bg-transparent group-hover:bg-primary/40 group-focus-visible:bg-primary/40",
          )}
        />
      </button>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <PanelRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{t("assistant.environment.title")}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label={t("workspace.environment.closeDock")}
            title={t("workspace.environment.closeDock")}
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{t("assistant.environment.changes")}</span>
            <span className="flex items-center gap-1.5 font-mono">
              <span className="font-semibold text-emerald-500">+{additions}</span>
              <span className="font-semibold text-rose-500">−{deletions}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <HardDrive className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("assistant.environment.local")}</span>
          </div>

          {localBranch || issueBranch ? (
            <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              {localBranch ? (
                <div className="flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  <span className="shrink-0">{t("assistant.environment.localBranch")}</span>
                  <span className="truncate font-mono" title={localBranch}>
                    {localBranch}
                  </span>
                </div>
              ) : null}
              {issueBranch ? (
                <div className="flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  <span className="shrink-0">{t("assistant.environment.issueBranch")}</span>
                  <span className="truncate font-mono" title={issueBranch}>
                    {issueBranch}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-start gap-2"
              aria-label={t("assistant.environment.commitPush")}
              onClick={openCommitPush}
            >
              <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t("assistant.environment.commitPush")}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-start gap-2"
              aria-label={t("assistant.environment.compare")}
              onClick={openCompare}
            >
              <GitCompare className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t("assistant.environment.compare")}</span>
            </Button>
          </div>

          {recentCommits.commits.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("assistant.environment.commits")}
              </p>
              <div className="flex flex-col gap-1">
                {recentCommits.commits.slice(0, RECENT_COMMITS_LIMIT).map((commit) => (
                  <button
                    key={`${commit.repo}:${commit.sha}`}
                    type="button"
                    className="flex w-full flex-col gap-0.5 rounded-md px-1.5 py-1 text-left hover:bg-muted/50"
                    onClick={openCompare}
                    title={commit.message}
                  >
                    <span className="truncate text-xs font-medium">{commit.message}</span>
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="font-mono">{commit.shortSha}</span>
                      <span
                        className={cn(
                          "rounded px-1 py-px font-medium",
                          commit.online
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {commit.online
                          ? t("issue.commits.online")
                          : t("issue.commits.local")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {linkedPullRequests.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("assistant.environment.linkedPullRequests")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {linkedPullRequests.map((pullRequest) => (
                  <PullRequestLink
                    key={pullRequest.url ?? `${pullRequest.repo}#${pullRequest.number}`}
                    pullRequest={pullRequest}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("assistant.environment.sources")}
            </p>
            <p className="truncate text-xs" title={projectSlug}>
              {projectSlug}
            </p>
          </div>
        </div>
      </div>

      <GitDiffLauncher
        projectSlug={projectSlug}
        identifier={issueIdentifier}
        openRequestId={compareRequestId}
        openCommitDialogRequestId={commitRequestId}
        showTrigger={false}
      />
    </aside>
  );
}

export { ENVIRONMENT_DOCK_WIDTH_STORAGE_KEY };
