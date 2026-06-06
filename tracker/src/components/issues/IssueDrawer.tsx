import {
  Activity,
  AlertTriangle,
  Archive,
  Bot,
  ChevronDown,
  Code2,
  FileText,
  GitPullRequest,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Server,
  ShieldAlert,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect } from "react";

import { getStatusMeta } from "@/components/board/status-meta";
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
import { useIssuePullRequests } from "@/hooks/useIssuePullRequests";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import { DEFAULT_ISSUE_TAB, type IssueTab, type WorkspaceView } from "@/lib/workspaceRoutes";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

import { ActivityTab } from "./issue-detail/ActivityTab";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { AgentTabs } from "./issue-detail/AgentTabs";
import { AssigneeAvatar } from "./AssigneeAvatar";
import { BlockersTab } from "./issue-detail/BlockersTab";
import { CommentsTab } from "./issue-detail/CommentsTab";
import { PriorityIndicator, priorityLabel } from "./PriorityIndicator";
import { PreviewTab } from "./issue-detail/PreviewTab";
import { PullRequestTab } from "./issue-detail/PullRequestTab";
import { rollupMeta } from "./pull-request/pr-meta";
import { SummaryTab } from "./issue-detail/SummaryTab";
import { TerminalTab } from "./issue-detail/TerminalTab";

const TABS = [
  { value: "summary", label: "Summary", Icon: FileText },
  { value: "pr", label: "Pull request", Icon: GitPullRequest },
  { value: "comments", label: "Comments", Icon: MessageSquare },
  { value: "blockers", label: "Blockers", Icon: ShieldAlert },
  { value: "agent", label: "Agent", Icon: Bot },
  { value: "preview", label: "Preview", Icon: Server },
  { value: "activity", label: "Activity", Icon: Activity },
  { value: "terminal", label: "Terminal", Icon: TerminalSquare },
] as const;

interface IssueDrawerProps {
  issue: Issue | null;
  projectSlug: string;
  view: WorkspaceView;
  execution?: AgentExecution;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab?: IssueTab;
  onTabChange?: (tab: IssueTab) => void;
  onArchive?: (issue: Issue) => void | Promise<void>;
  onDelete?: (issue: Issue) => void | Promise<void>;
  onForceSync?: (issue: Issue) => void | Promise<void>;
  onIssueUpdated?: (issue: Issue) => void;
}

export function IssueDrawer({
  issue,
  projectSlug,
  view,
  execution,
  open,
  onOpenChange,
  tab = DEFAULT_ISSUE_TAB,
  onTabChange,
  onArchive,
  onDelete,
  onForceSync,
  onIssueUpdated,
}: IssueDrawerProps) {
  const meta = issue ? getStatusMeta(issue.status) : null;
  const StatusIcon = meta?.Icon;

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
  const blockersCount = issue?.blockedBy.length ?? 0;
  const showBrowserEditor = editor.browser.reason !== "disabled";
  const anyEditorAvailable = editor.browser.available || editor.cursorDesktop.available;
  const editorMenuTitle = editor.browser.available
    ? "Open this task's workspace in VS Code (.)"
    : editorUnavailableTitle(editor.browser.reason ?? editor.cursorDesktop.reason, editor.loading);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
        {issue ? (
          <>
            <SheetHeader className="gap-0 space-y-0 border-b border-border/70 px-6 pb-0 pt-5">
              <div className="flex items-start gap-3 pr-9">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {issue.identifier}
                  </span>
                  {issue.blockedBy.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" />
                      Blocked
                    </span>
                  ) : null}
                  {execution ? <AgentStatusBadge status={execution.status} /> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          disabled={!anyEditorAvailable && !editor.loading}
                          title={editorMenuTitle}
                          aria-label="Open in VS Code"
                          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Code2 className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">VS Code</span>
                          <ChevronDown className="h-3 w-3 opacity-60" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        {showBrowserEditor ? (
                          <DropdownMenuItem
                            disabled={!editor.browser.available}
                            title={
                              editor.browser.available
                                ? "Open in VS Code (browser)"
                                : editorUnavailableTitle(editor.browser.reason, editor.loading)
                            }
                            onSelect={() => openBrowserEditor()}
                          >
                            <Code2 className="mr-2 h-4 w-4" />
                            VS Code
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          disabled={!editor.cursorDesktop.available}
                          title={
                            editor.cursorDesktop.available
                              ? "Open in Cursor Desktop (local app)"
                              : editorUnavailableTitle(editor.cursorDesktop.reason, editor.loading)
                          }
                          onSelect={() => openCursorDesktop()}
                        >
                          <Code2 className="mr-2 h-4 w-4" />
                          Cursor Desktop
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  {onArchive || onDelete || onForceSync ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="Issue actions"
                          title="Issue actions"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-40">
                        {onForceSync ? (
                          <DropdownMenuItem onSelect={() => void handleForceSync(issue)}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Sync from remote
                          </DropdownMenuItem>
                        ) : null}
                        {onArchive ? (
                          <DropdownMenuItem onSelect={() => void onArchive(issue)}>
                            <Archive className="mr-2 h-4 w-4" />
                            Archive
                          </DropdownMenuItem>
                        ) : null}
                        {onDelete ? (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => {
                              if (
                                window.confirm(
                                  `Delete ${issue.identifier} permanently? This removes it from the board and cannot be undone.`,
                                )
                              ) {
                                void onDelete(issue);
                              }
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
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
                  aria-label="Issue title"
                  placeholder="Untitled issue"
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
                    {priorityLabel(issue.priority)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-muted-foreground">
                    <AssigneeAvatar login={issue.assignee} />
                    {issue.assignee ?? "Unassigned"}
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
                {TABS.map(({ value, label, Icon }) => (
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
                    {label}
                    {value === "pr" && prRollup ? (
                      <prRollup.Icon className={cn("h-3 w-3", prRollup.className, prRollup.spin && "animate-spin")} />
                    ) : null}
                    {value === "comments" && commentsCount > 0 ? <TabCount>{commentsCount}</TabCount> : null}
                    {value === "blockers" && blockersCount > 0 ? <TabCount tone="amber">{blockersCount}</TabCount> : null}
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className={cn("min-h-0 flex-1 overflow-auto px-6 py-5", SCROLLBAR_THIN)}>
                <TabsContent value="summary">
                  <SummaryTab
                    issue={issue}
                    projectSlug={projectSlug}
                    pullRequests={pr.pullRequests}
                    workpad={commentsState.workpad}
                    saving={issueUpdater.saving}
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
                  />
                </TabsContent>
                <TabsContent value="pr">
                  <PullRequestTab
                    issue={issue}
                    projectSlug={projectSlug}
                    pullRequests={pr.pullRequests}
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
                    onAddComment={commentsState.addComment}
                  />
                </TabsContent>
                <TabsContent value="blockers"><BlockersTab projectSlug={projectSlug} issue={issue} /></TabsContent>
                <TabsContent value="agent" className="h-full min-h-0">
                  <AgentTabs issue={issue} projectSlug={projectSlug} execution={execution} view={view} />
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
                <TabsContent value="terminal"><TerminalTab issue={issue} /></TabsContent>
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

function editorUnavailableTitle(reason: EditorReason | null, loading: boolean): string {
  if (loading) return "Checking editor…";
  switch (reason) {
    case "starting":
      return "Editor is starting…";
    case "workspace_missing":
      return "Workspace not created yet — run the agent or open the terminal first";
    case "workspace_skills_unavailable":
      return "Workspace is still preparing — try again in a moment";
    case "unavailable":
      return "Editor unavailable — restart Symphony after upgrading (make build && make update)";
    default:
      return "Editor unavailable";
  }
}
