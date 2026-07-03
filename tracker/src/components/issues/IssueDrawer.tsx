import {
  Activity,
  AlertTriangle,
  Archive,
  Bot,
  ChevronDown,
  ClipboardCheck,
  Code2,
  FileText,
  GitPullRequest,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Server,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { getStatusMeta } from "@/components/board/status-meta";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InlineEditableText } from "@/components/issues/inline/InlineEditableText";
import { useIssueComments } from "@/hooks/useIssueComments";
import { useIssueEditor } from "@/hooks/useIssueEditor";
import { useIssueUpdater } from "@/hooks/useIssueUpdater";
import type { EditorReason } from "@/services/editor";
import { useIssueCommitEvidence } from "@/hooks/useIssueCommitEvidence";
import { useIssueEvidence } from "@/hooks/useIssueEvidence";
import { useIssuePullRequests } from "@/hooks/useIssuePullRequests";
import { useLabSettings } from "@/hooks/useLabSettings";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import { issueDisplayIdentifier } from "@/lib/issueIdentifiers";
import { canResumeExecution } from "@/lib/agentExecutionDisplay";
import { evidenceNeedsAttention } from "@/lib/evidenceStatus";
import { isWaitState, parseWorkflowTrackerConfig } from "@/lib/workflowTracker";
import { DEFAULT_ISSUE_TAB, type IssueTab, type WorkspaceView } from "@/lib/workspaceRoutes";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

import { ActivityTab } from "./issue-detail/ActivityTab";
import { AgentLongRunningBadge, AgentStatusBadge } from "./AgentStatusBadge";
import { AgentResumeIconButton } from "./AgentResumeIconButton";
import { resolveDisplayStatus } from "@/lib/agentExecutionDisplay";
import { AgentTabs } from "./issue-detail/AgentTabs";
import { AssigneeAvatar } from "./AssigneeAvatar";
import { CommentsTab } from "./issue-detail/CommentsTab";
import { EvidenceTab } from "./issue-detail/EvidenceTab";
import { PriorityIndicator, priorityLabel } from "./PriorityIndicator";
import { PreviewTab } from "./issue-detail/PreviewTab";
import { PullRequestTab } from "./issue-detail/PullRequestTab";
import { rollupMeta } from "./pull-request/pr-meta";
import { SummaryTab } from "./issue-detail/SummaryTab";
import { TerminalTab } from "./issue-detail/TerminalTab";

const TAB_DEFS = [
  { value: "summary", labelKey: "issue.drawer.tabs.summary", Icon: FileText },
  { value: "pr", labelKey: "issue.drawer.tabs.pr", Icon: GitPullRequest },
  { value: "comments", labelKey: "issue.drawer.tabs.comments", Icon: MessageSquare },
  { value: "evidence", labelKey: "issue.drawer.tabs.evidence", Icon: ClipboardCheck },
  { value: "agent", labelKey: "issue.drawer.tabs.agent", Icon: Bot },
  { value: "preview", labelKey: "issue.drawer.tabs.preview", Icon: Server },
  { value: "activity", labelKey: "issue.drawer.tabs.activity", Icon: Activity },
  { value: "terminal", labelKey: "issue.drawer.tabs.terminal", Icon: TerminalSquare },
] as const;

interface IssueDrawerProps {
  issue: Issue | null;
  projectSlug: string;
  view: WorkspaceView;
  execution?: AgentExecution;
  subtasks?: Issue[];
  subtaskExecutions?: ReadonlyMap<string, AgentExecution>;
  parentCandidates?: Issue[];
  workflowMarkdown?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab?: IssueTab;
  onTabChange?: (tab: IssueTab) => void;
  onOpenAgentExecution?: () => void;
  onArchive?: (issue: Issue) => void | Promise<void>;
  onDelete?: (issue: Issue) => void | Promise<void>;
  onForceSync?: (issue: Issue) => void | Promise<void>;
  onRemoveAttachment?: (attachmentId: string) => Promise<boolean>;
  onIssueUpdated?: (updated: Issue) => void;
  onOpenIssue?: (identifier: string) => void;
  onCreateSubtask?: (title: string) => Promise<boolean>;
  onSetParent?: (parentIdentifier: string) => Promise<boolean>;
  onClearParent?: () => Promise<boolean>;
}

export function IssueDrawer({
  issue,
  projectSlug,
  view,
  execution,
  subtasks = [],
  subtaskExecutions,
  parentCandidates = [],
  workflowMarkdown = null,
  open,
  onOpenChange,
  tab = DEFAULT_ISSUE_TAB,
  onTabChange,
  onArchive,
  onDelete,
  onForceSync,
  onRemoveAttachment,
  onIssueUpdated,
  onOpenIssue,
  onCreateSubtask,
  onSetParent,
  onClearParent,
}: IssueDrawerProps) {
  const { t } = useTranslation();
  const meta = issue ? getStatusMeta(issue.status) : null;
  const StatusIcon = meta?.Icon;

  const lab = useLabSettings(open && Boolean(issue));
  const labBundleChildOrchestration = lab.bundle_child_orchestration;

  const pr = useIssuePullRequests({
    projectSlug,
    identifier: issue?.identifier ?? null,
    enabled: open && Boolean(issue),
  });
  const primaryPr = pr.pullRequests[0] ?? null;
  const prRollup = primaryPr ? rollupMeta(primaryPr.checksState) : null;

  const commentsState = useIssueComments({
    projectSlug,
    identifier: issue?.identifier ?? null,
    enabled: open && Boolean(issue),
  });

  const evidence = useIssueEvidence({
    projectSlug,
    identifier: issue?.identifier ?? null,
    enabled: open && Boolean(issue),
  });

  const commitEvidence = useIssueCommitEvidence({
    projectSlug,
    identifier: issue?.identifier ?? null,
    enabled: open && Boolean(issue),
  });

  const editor = useIssueEditor({
    projectSlug,
    identifier: issue?.identifier ?? null,
    enabled: open && Boolean(issue),
  });

  const issueUpdater = useIssueUpdater({
    projectSlug,
    issue,
    onUpdated: onIssueUpdated,
  });

  const trackerConfig = parseWorkflowTrackerConfig(workflowMarkdown);
  const inWaitState = issue ? isWaitState(issue.status, trackerConfig) : false;
  const evidenceNeedsResume = !evidence.loading && evidenceNeedsAttention(evidence.records);
  const showEvidenceContinueWork =
    inWaitState && evidenceNeedsResume && canResumeExecution(execution);

  const openBrowserEditor = useCallback(() => {
    if (editor.browser.available && editor.browser.url) {
      window.open(editor.browser.url, "_blank", "noopener");
    }
  }, [editor.browser.available, editor.browser.url]);

  const openCursorDesktop = useCallback(() => {
    if (editor.cursorDesktop.available && editor.cursorDesktop.url) {
      openDesktopProtocolUrl(editor.cursorDesktop.url);
    }
  }, [editor.cursorDesktop.available, editor.cursorDesktop.url]);

  const openDefaultEditor = useCallback(() => {
    if (editor.browser.available) {
      openBrowserEditor();
      return;
    }
    openCursorDesktop();
  }, [editor.browser.available, openBrowserEditor, openCursorDesktop]);

  useEffect(() => {
    if (!open) return undefined;

    const handler = (event: KeyboardEvent) => {
      if (event.key !== "." || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      openDefaultEditor();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, openDefaultEditor]);

  const handleForceSync = useCallback(
    async (target: Issue) => {
      if (!onForceSync) return;
      await onForceSync(target);
      await commentsState.refetch();
    },
    [onForceSync, commentsState],
  );

  const commentsCount = commentsState.comments.length;
  const anyEditorAvailable = editor.browser.available || editor.cursorDesktop.available;
  const editorMenuTitle = editor.browser.available
    ? t("issue.drawer.openWorkspaceCode")
    : editorUnavailableTitle(editor.browser.reason ?? editor.cursorDesktop.reason, editor.loading, t);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
        {issue ? (
          <>
            <SheetHeader className="gap-0 space-y-0 border-b border-border/70 px-6 pb-0 pt-5">
              <div className="flex items-start gap-3 pr-9">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {issueDisplayIdentifier(issue)}
                  </span>
                  {issue.blockedBy.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" />
                      {t("issue.drawer.blocked")}
                    </span>
                  ) : null}
                  {execution ? (
                    <span className="inline-flex items-center gap-0.5">
                      <AgentStatusBadge status={resolveDisplayStatus(execution)} />
                      <AgentResumeIconButton
                        projectSlug={projectSlug}
                        issueIdentifier={issue.identifier}
                        execution={execution}
                        onIssueUpdated={onIssueUpdated}
                      />
                    </span>
                  ) : null}
                  {execution ? <AgentLongRunningBadge execution={execution} /> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!anyEditorAvailable && !editor.loading}
                          title={editorMenuTitle}
                          aria-label={t("issue.drawer.openInCode")}
                        >
                          <Code2 className="h-4 w-4" />
                          <span className="hidden sm:inline">{t("issue.drawer.code")}</span>
                          <ChevronDown className="h-4 w-4 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem
                          disabled={!editor.browser.available}
                          title={
                            editor.browser.available
                              ? t("issue.drawer.openInCodeBrowser")
                              : editorUnavailableTitle(editor.browser.reason, editor.loading, t)
                          }
                          onSelect={() => openBrowserEditor()}
                        >
                          <Code2 className="mr-2 h-4 w-4" />
                          {t("issue.drawer.editor.vsCode")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!editor.cursorDesktop.available}
                          title={
                            editor.cursorDesktop.available
                              ? t("issue.drawer.openInCursor")
                              : editorUnavailableTitle(editor.cursorDesktop.reason, editor.loading, t)
                          }
                          onSelect={() => openCursorDesktop()}
                        >
                          <Code2 className="mr-2 h-4 w-4" />
                          {t("issue.drawer.editor.cursor")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  {onArchive || onDelete || onForceSync ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={t("issue.drawer.issueActions")}
                          title={t("issue.drawer.issueActions")}
                          className="w-8 px-0 text-muted-foreground"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-40">
                        {onForceSync ? (
                          <DropdownMenuItem onSelect={() => void handleForceSync(issue)}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {t("issue.drawer.syncFromRemote")}
                          </DropdownMenuItem>
                        ) : null}
                        {onArchive ? (
                          <DropdownMenuItem onSelect={() => void onArchive(issue)}>
                            <Archive className="mr-2 h-4 w-4" />
                            {t("issue.drawer.archive")}
                          </DropdownMenuItem>
                        ) : null}
                        {onDelete ? (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => {
                              if (
                                window.confirm(
                                  t("issue.drawer.deleteConfirm", { identifier: issue.identifier }),
                                )
                              ) {
                                void onDelete(issue);
                              }
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t("issue.drawer.delete")}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </div>
              <SheetTitle className="mt-3 text-[1.35rem] font-semibold leading-snug tracking-tight text-foreground" asChild>
                <InlineEditableText
                  value={issue.title}
                  aria-label={t("issue.drawer.issueTitleAria")}
                  placeholder={t("issue.drawer.untitledIssue")}
                  saving={issueUpdater.saving}
                  displayClassName="px-1 py-0.5 text-[1.35rem] font-semibold leading-snug tracking-tight"
                  inputClassName="text-[1.35rem] font-semibold leading-snug tracking-tight"
                  onSave={async (title) => {
                    if (!issue) return false;
                    const updated = await issueUpdater.save({ title });
                    return updated !== null;
                  }}
                />
              </SheetTitle>
              <SheetDescription asChild>
                <div className="mb-4 mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 font-medium text-foreground">
                    {StatusIcon ? <StatusIcon className={cn("h-3.5 w-3.5", meta?.iconClass)} /> : null}
                    {issue.status}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-muted-foreground">
                    <PriorityIndicator priority={issue.priority} />
                    {priorityLabel(issue.priority, t)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-muted-foreground">
                    <AssigneeAvatar login={issue.assignee} />
                    {issue.assignee ?? t("issue.drawer.unassigned")}
                  </span>
                </div>
              </SheetDescription>
            </SheetHeader>
            <Tabs
              value={tab}
              onValueChange={(value) => onTabChange?.(value as IssueTab)}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <TabsList
                className={cn(
                  "h-auto w-full shrink-0 justify-start gap-0.5 overflow-x-auto rounded-none border-b border-border/70 bg-transparent px-4 py-0",
                  "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                )}
              >
                {TAB_DEFS.map(({ value, labelKey, Icon }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className={cn(
                      "group relative shrink-0 gap-1.5 rounded-none border-0 bg-transparent px-3 pb-3 pt-2.5 text-[13px] font-medium text-muted-foreground shadow-none transition-colors",
                      "hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
                      "after:pointer-events-none after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent after:transition-colors data-[state=active]:after:bg-primary",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 opacity-80 group-data-[state=active]:opacity-100" />
                    {t(labelKey)}
                    {value === "pr" && prRollup ? (
                      <prRollup.Icon className={cn("h-3 w-3", prRollup.className, prRollup.spin && "animate-spin")} />
                    ) : null}
                    {value === "comments" && commentsCount > 0 ? <TabCount>{commentsCount}</TabCount> : null}
                  </TabsTrigger>
                ))}
              </TabsList>
              <div
                className={cn(
                  "relative min-h-0 flex-1",
                  tab === "agent" || tab === "terminal"
                    ? "flex flex-col overflow-hidden px-4 py-3 sm:px-6"
                    : cn("overflow-auto px-6 py-5", SCROLLBAR_THIN),
                )}
              >
                <TabsContent value="summary">
                  <SummaryTab
                    issue={issue}
                    projectSlug={projectSlug}
                    pullRequests={pr.pullRequests}
                    pullRequestChildren={pr.children}
                    labBundleChildOrchestration={labBundleChildOrchestration}
                    workpad={commentsState.workpad}
                    subtasks={subtasks}
                    subtaskExecutions={subtaskExecutions}
                    parentCandidates={parentCandidates}
                    saving={issueUpdater.saving}
                    onOpenIssue={onOpenIssue}
                    onCreateSubtask={onCreateSubtask}
                    onSetParent={onSetParent}
                    onClearParent={onClearParent}
                    onOpenPullRequest={() => onTabChange?.("pr")}
                    onOpenComments={() => onTabChange?.("comments")}
                    onSaveDescription={async (description) => {
                      const updated = await issueUpdater.save({ description });
                      return updated !== null;
                    }}
                    onSaveLabels={async (labelIds) => {
                      const updated = await issueUpdater.save({ labelIds });
                      return updated !== null;
                    }}
                    onSaveStatus={async (status) => {
                      const updated = await issueUpdater.moveStatus(status);
                      return updated !== null;
                    }}
                    onSavePriority={async (priority) => {
                      const updated = await issueUpdater.save({ priority });
                      return updated !== null;
                    }}
                    onSaveAssignee={async (assigneeIds) => {
                      const updated = await issueUpdater.save({ assigneeIds });
                      return updated !== null;
                    }}
                    onSaveAgent={async (agent) => {
                      const updated = await issueUpdater.save({ agent });
                      return updated !== null;
                    }}
                    onRemoveAttachment={onRemoveAttachment}
                  />
                </TabsContent>
                <TabsContent value="pr">
                  <PullRequestTab
                    issue={issue}
                    projectSlug={projectSlug}
                    pullRequests={pr.pullRequests}
                    pullRequestChildren={pr.children}
                    labBundleChildOrchestration={labBundleChildOrchestration}
                    supported={pr.supported}
                    available={pr.available}
                    loading={pr.loading}
                    error={pr.error}
                    onRefresh={() => void pr.refetch()}
                  />
                </TabsContent>
                <TabsContent value="comments">
                  <CommentsTab
                    comments={commentsState.comments}
                    loading={commentsState.loading}
                    error={commentsState.error}
                    projectSlug={projectSlug}
                    onAddComment={commentsState.addComment}
                    onUpdateComment={commentsState.updateComment}
                    onDeleteComment={commentsState.deleteComment}
                  />
                </TabsContent>
                <TabsContent value="evidence">
                  <EvidenceTab
                    commitWorkspace={commitEvidence.workspace}
                    commits={commitEvidence.commits}
                    commitsError={commitEvidence.error}
                    commitsLoading={commitEvidence.loading}
                    error={evidence.error}
                    identifier={issue.identifier}
                    issue={issue}
                    loading={evidence.loading}
                    onIssueUpdated={onIssueUpdated}
                    onRefresh={() => void evidence.refetch()}
                    onRefreshCommits={() => void commitEvidence.refetch()}
                    projectSlug={projectSlug}
                    records={evidence.records}
                    showContinueWork={showEvidenceContinueWork}
                    trackerConfig={trackerConfig}
                  />
                </TabsContent>
                <TabsContent value="agent" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
                  <AgentTabs
                    issue={issue}
                    projectSlug={projectSlug}
                    execution={execution}
                    view={view}
                    workflowMarkdown={workflowMarkdown}
                    evidenceRecords={evidence.records}
                    onIssueUpdated={onIssueUpdated}
                  />
                </TabsContent>
                <TabsContent value="preview">
                  <PreviewTab
                    projectSlug={projectSlug}
                    issueIdentifier={issue.identifier}
                    view={view}
                    execution={execution}
                  />
                </TabsContent>
                <TabsContent value="activity">
                  <ActivityTab projectSlug={projectSlug} issue={issue} execution={execution} />
                </TabsContent>
                <TabsContent value="terminal" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
                  <TerminalTab issue={issue} />
                </TabsContent>
              </div>
            </Tabs>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function TabCount({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "amber" }) {
  return (
    <span
      className={cn(
        "ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums",
        tone === "amber"
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
          : "bg-muted text-muted-foreground group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary",
      )}
    >
      {children}
    </span>
  );
}

function openDesktopProtocolUrl(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function editorUnavailableTitle(
  reason: EditorReason | null,
  loading: boolean,
  t: (key: string) => string,
): string {
  if (loading) return t("issue.drawer.editor.checking");
  switch (reason) {
    case "starting":
      return t("issue.drawer.editor.starting");
    case "workspace_missing":
      return t("issue.drawer.editor.workspaceMissing");
    case "workspace_skills_unavailable":
      return t("issue.drawer.editor.workspacePreparing");
    case "unavailable":
      return t("issue.drawer.editor.unavailableUpgrade");
    default:
      return t("issue.drawer.editor.unavailable");
  }
}
