import {
  Activity,
  AlertTriangle,
  Bot,
  Code2,
  FileText,
  GitPullRequest,
  MessageSquare,
  ShieldAlert,
  TerminalSquare,
} from "lucide-react";
import { useCallback, useEffect } from "react";

import { getStatusMeta } from "@/components/board/status-meta";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIssueComments } from "@/hooks/useIssueComments";
import { useIssueEditor } from "@/hooks/useIssueEditor";
import { useIssuePullRequests } from "@/hooks/useIssuePullRequests";
import { cn } from "@/lib/utils";
import { DEFAULT_ISSUE_TAB, type IssueTab } from "@/lib/workspaceRoutes";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

import { ActivityTab } from "./issue-detail/ActivityTab";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { AgentTab } from "./issue-detail/AgentTab";
import { AssigneeAvatar } from "./AssigneeAvatar";
import { BlockersTab } from "./issue-detail/BlockersTab";
import { CommentsTab } from "./issue-detail/CommentsTab";
import { PriorityIndicator, priorityLabel } from "./PriorityIndicator";
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
  { value: "activity", label: "Activity", Icon: Activity },
  { value: "terminal", label: "Terminal", Icon: TerminalSquare },
] as const;

interface IssueDrawerProps {
  issue: Issue | null;
  projectSlug: string;
  execution?: AgentExecution;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab?: IssueTab;
  onTabChange?: (tab: IssueTab) => void;
}

export function IssueDrawer({
  issue,
  projectSlug,
  execution,
  open,
  onOpenChange,
  tab = DEFAULT_ISSUE_TAB,
  onTabChange,
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

  const openEditor = useCallback(() => {
    if (editor.available && editor.url) {
      window.open(editor.url, "_blank", "noopener");
    }
  }, [editor.available, editor.url]);

  useEffect(() => {
    if (!open) return undefined;

    const handler = (event: KeyboardEvent) => {
      if (event.key !== "." || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      openEditor();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, openEditor]);

  const editorButtonHidden = editor.reason === "disabled";
  const editorTitle = editor.available
    ? "Open this task's workspace in VS Code (.)"
    : editorUnavailableTitle(editor.reason, editor.loading);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
        {issue ? (
          <>
            <SheetHeader className="border-b p-6 pb-4">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono font-semibold uppercase tracking-wide text-muted-foreground">
                  {issue.identifier}
                </span>
                {issue.blockedBy.length > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3" />
                    Blocked
                  </span>
                ) : null}
                {execution ? <AgentStatusBadge status={execution.status} /> : null}
                {editorButtonHidden ? null : (
                  <button
                    type="button"
                    onClick={openEditor}
                    disabled={!editor.available}
                    title={editorTitle}
                    aria-label="Open in VS Code"
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Code2 className="h-3 w-3" />
                    Open in VS Code
                  </button>
                )}
              </div>
              <SheetTitle className="pr-8 text-xl leading-tight">{issue.title}</SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs font-medium text-foreground">
                    {StatusIcon ? <StatusIcon className={cn("h-3.5 w-3.5", meta?.iconClass)} /> : null}
                    {issue.status}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <PriorityIndicator priority={issue.priority} />
                    {priorityLabel(issue.priority)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <AssigneeAvatar login={issue.assignee} />
                    {issue.assignee ?? "Unassigned"}
                  </span>
                </div>
              </SheetDescription>
            </SheetHeader>
            <Tabs
              value={tab}
              onValueChange={(value) => onTabChange?.(value as IssueTab)}
              className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4"
            >
              <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0">
                {TABS.map(({ value, label, Icon }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="gap-1.5 rounded-none border-b-2 border-transparent px-2.5 pb-2 pt-1 text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                    {value === "pr" && prRollup ? (
                      <prRollup.Icon className={cn("h-3 w-3", prRollup.className, prRollup.spin && "animate-spin")} />
                    ) : null}
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
                <TabsContent value="summary">
                  <SummaryTab
                    issue={issue}
                    pullRequests={pr.pullRequests}
                    workpad={commentsState.workpad}
                    onOpenPullRequest={() => onTabChange?.("pr")}
                    onOpenComments={() => onTabChange?.("comments")}
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
                <TabsContent value="agent"><AgentTab issue={issue} execution={execution} /></TabsContent>
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

function editorUnavailableTitle(reason: string | null, loading: boolean): string {
  if (loading) return "Checking editor…";
  switch (reason) {
    case "starting":
      return "Editor is starting…";
    case "workspace_missing":
      return "Workspace not created yet — run the agent or open the terminal first";
    default:
      return "Editor unavailable";
  }
}
