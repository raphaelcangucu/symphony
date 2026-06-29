import { ExternalLink, GitBranch } from "lucide-react";
import type { TFunction } from "i18next";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getStatusMeta } from "@/components/board/status-meta";
import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { agentKindLabel } from "@/components/shared/AgentChip";
import { InlineAgentEditor } from "@/components/issues/inline/InlineAgentEditor";
import { InlineAssigneeEditor } from "@/components/issues/inline/InlineAssigneeEditor";
import { InlineEditableMarkdown } from "@/components/issues/inline/InlineEditableMarkdown";
import { InlineIssuePicker } from "@/components/issues/inline/InlineIssuePicker";
import { InlineLabelEditor } from "@/components/issues/inline/InlineLabelEditor";
import { InlinePriorityEditor } from "@/components/issues/inline/InlinePriorityEditor";
import { InlineStatusEditor } from "@/components/issues/inline/InlineStatusEditor";
import { PriorityIndicator, priorityLabel } from "@/components/issues/PriorityIndicator";
import { PullRequestLink } from "@/components/issues/pull-request/PullRequestLink";
import { Separator } from "@/components/ui/separator";
import { useIssueDevServers } from "@/hooks/useIssueDevServers";
import { userVisibleLabels } from "@/lib/symphonyLabels";
import { cn, formatDateTime } from "@/lib/utils";
import { getIssueFormOptions } from "@/services/issues";
import type { AgentExecution } from "@/types/agent-execution";
import type { Comment } from "@/types/comment";
import type {
  AgentKind,
  AgentOption,
  Issue,
  IssueAssigneeOption,
  IssueDevServer,
  IssueDevServersResponse,
  IssueLabelOption,
  IssuePriority,
} from "@/types/issue";
import type { PullRequest, PullRequestGroup } from "@/types/pull-request";
import type { WorkflowStatusName } from "@/types/workflow-status";

import { BlockedBanner } from "./BlockedBanner";
import { CommentCard, SyncBadge, WorkpadBadge } from "./CommentCard";
import { IssueAttachments } from "./IssueAttachments";
import { SubIssuesSection } from "./SubIssuesSection";

interface SummaryTabProps {
  issue: Issue;
  projectSlug: string;
  pullRequests?: PullRequest[];
  pullRequestChildren?: PullRequestGroup[];
  workpad?: Comment | null;
  subtasks?: Issue[];
  subtaskExecutions?: ReadonlyMap<string, AgentExecution>;
  parentCandidates?: Issue[];
  groupLeadCandidates?: Issue[];
  saving?: boolean;
  onOpenIssue?: (identifier: string) => void;
  onOpenPullRequest?: () => void;
  onOpenComments?: () => void;
  onSaveDescription?: (description: string) => Promise<boolean>;
  onSaveLabels?: (labelIds: string[]) => Promise<boolean>;
  onSaveStatus?: (status: WorkflowStatusName) => Promise<boolean>;
  onSavePriority?: (priority: IssuePriority | null) => Promise<boolean>;
  onSaveAssignee?: (assigneeIds: string[]) => Promise<boolean>;
  onSaveAgent?: (agent: AgentKind | null) => Promise<boolean>;
  onRemoveAttachment?: (attachmentId: string) => Promise<boolean>;
  onCreateSubtask?: (title: string) => Promise<boolean>;
  onSetParent?: (parentIdentifier: string) => Promise<boolean>;
  onClearParent?: () => Promise<boolean>;
  onSetGroupLead?: (leadIdentifier: string) => Promise<boolean>;
  onClearGroupLead?: () => Promise<boolean>;
}

function issueLinkLabel(url: string, t: TFunction): string {
  if (url.includes("github.com")) return t("issue.summary.openInGitHub");
  if (url.includes("linear.app")) return t("issue.summary.openInLinear");
  return t("issue.summary.openIssue");
}

export function SummaryTab({
  issue,
  projectSlug,
  pullRequests = [],
  pullRequestChildren = [],
  workpad = null,
  subtasks = [],
  subtaskExecutions,
  parentCandidates = [],
  groupLeadCandidates = [],
  saving = false,
  onOpenIssue,
  onOpenPullRequest,
  onOpenComments,
  onSaveDescription,
  onSaveLabels,
  onSaveStatus,
  onSavePriority,
  onSaveAssignee,
  onSaveAgent,
  onRemoveAttachment,
  onCreateSubtask,
  onSetParent,
  onClearParent,
  onSetGroupLead,
  onClearGroupLead,
}: SummaryTabProps) {
  const { t } = useTranslation();
  const [labelOptions, setLabelOptions] = useState<IssueLabelOption[]>([]);
  const [assigneeOptions, setAssigneeOptions] = useState<IssueAssigneeOption[]>([]);
  const [statusOptions, setStatusOptions] = useState<WorkflowStatusName[]>([]);
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [effectiveAgent, setEffectiveAgent] = useState<AgentKind>("codex");
  const [labelOptionsLoading, setLabelOptionsLoading] = useState(false);
  const meta = getStatusMeta(issue.status);
  const StatusIcon = meta.Icon;
  const { data: previewData } = useIssueDevServers(issue.projectSlug, issue.identifier);
  const primaryPreviewServer = selectPrimaryPreviewServer(previewData?.servers ?? []);
  const previewUrl = readyPreviewUrl(primaryPreviewServer);
  const previewStatus = previewUrl ? null : previewStatusLabel(previewData, primaryPreviewServer, t);
  const hasPreviewSummary = Boolean(previewUrl || previewStatus);
  const ownPrUrls = new Set(pullRequests.map((pr) => pr.url).filter((url): url is string => Boolean(url)));
  const childPullRequests = pullRequestChildren
    .flatMap((group) => group.pullRequests)
    .filter((pr) => !pr.url || !ownPrUrls.has(pr.url));
  const hasLinks =
    Boolean(issue.url) ||
    issue.branchName !== null ||
    pullRequests.length > 0 ||
    childPullRequests.length > 0 ||
    hasPreviewSummary;
  const editable = Boolean(
    onSaveDescription || onSaveLabels || onSaveStatus || onSavePriority || onSaveAssignee || onSaveAgent,
  );

  useEffect(() => {
    if (!editable || !projectSlug.trim()) return undefined;

    let cancelled = false;
    setLabelOptionsLoading(true);
    void getIssueFormOptions(projectSlug)
      .then((options) => {
        if (!cancelled) {
          setLabelOptions(options.labels);
          setAssigneeOptions(options.assignees);
          setStatusOptions(options.statuses);
          setAgentOptions(options.agents);
          setEffectiveAgent(options.effectiveAgent);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLabelOptions([]);
          setAssigneeOptions([]);
          setAgentOptions([]);
          setEffectiveAgent("codex");
        }
      })
      .finally(() => {
        if (!cancelled) setLabelOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editable, projectSlug]);

  return (
    <div className="grid gap-x-8 gap-y-6 text-sm lg:grid-cols-[minmax(0,1fr)_236px]">
      <div className="min-w-0 space-y-6">
        <BlockedBanner labels={issue.labels} />
        {hasLinks ? (
          <section className="flex flex-wrap items-center gap-2">
            {issue.url ? (
              <a
                href={issue.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {issueLinkLabel(issue.url, t)}
              </a>
            ) : null}
            {issue.branchName ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 font-mono text-xs text-muted-foreground">
                <GitBranch className="h-3.5 w-3.5" />
                {issue.branchName}
              </span>
            ) : null}
            {pullRequests.map((pr) => (
              <PullRequestLink
                key={pr.url ?? `${pr.repo}#${pr.number}`}
                pullRequest={pr}
                onOpen={onOpenPullRequest}
              />
            ))}
            {childPullRequests.map((pr) => (
              <PullRequestLink
                key={`child-${pr.url ?? `${pr.repo}#${pr.number}`}`}
                pullRequest={pr}
                onOpen={onOpenPullRequest}
              />
            ))}
            {previewUrl ? (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("issue.summary.preview")}
              </a>
            ) : null}
            {previewStatus ? (
              <span
                role="status"
                aria-live="polite"
                className="inline-flex items-center rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-muted-foreground"
              >
                {previewStatus}
              </span>
            ) : null}
          </section>
        ) : null}
        <section>
          <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("issue.summary.description")}
          </h3>
          {onSaveDescription ? (
            <InlineEditableMarkdown
              value={issue.description ?? ""}
              projectSlug={projectSlug}
              saving={saving}
              onSave={onSaveDescription}
            />
          ) : issue.description?.trim() ? (
            <p className="whitespace-pre-wrap text-sm">{issue.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("issue.summary.noDescription")}</p>
          )}
        </section>
        <SubIssuesSection
          subtasks={subtasks}
          summary={issue.subIssueSummary}
          executions={subtaskExecutions}
          onOpenIssue={onOpenIssue}
          onCreateSubtask={onCreateSubtask}
        />
        <IssueAttachments
          attachments={issue.attachments}
          projectSlug={projectSlug || issue.projectSlug}
          onRemoveAttachment={onRemoveAttachment}
        />
        {workpad ? (
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("issue.summary.agentWorkpad")}
            </h3>
            <CommentCard
              author={workpad.author}
              body={workpad.body}
              createdAt={workpad.createdAt}
              url={workpad.url}
              highlight
              badge={
                <>
                  <WorkpadBadge />
                  <SyncBadge syncStatus={workpad.syncStatus} />
                </>
              }
              actions={
                onOpenComments ? (
                  <button type="button" onClick={onOpenComments} className="text-xs text-primary hover:underline">
                    {t("issue.summary.viewAllComments")}
                  </button>
                ) : null
              }
            />
          </section>
        ) : null}
      </div>

      <aside className="space-y-5 lg:border-l lg:border-border/70 lg:pl-6">
        <div className="space-y-4">
          <Field label={t("issue.summary.status")}>
            {onSaveStatus ? (
              <InlineStatusEditor
                status={issue.status}
                options={statusOptions.length > 0 ? statusOptions : [issue.status]}
                saving={saving}
                onSave={onSaveStatus}
              />
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-xs font-medium">
                <StatusIcon className={cn("h-3.5 w-3.5", meta.iconClass)} />
                {issue.status}
              </span>
            )}
          </Field>
          <Field label={t("issue.summary.priority")}>
            {onSavePriority ? (
              <InlinePriorityEditor priority={issue.priority} saving={saving} onSave={onSavePriority} />
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <PriorityIndicator priority={issue.priority} />
                {priorityLabel(issue.priority)}
              </span>
            )}
          </Field>
          <Field label={t("issue.summary.assignee")}>
            {onSaveAssignee ? (
              <InlineAssigneeEditor
                assignee={issue.assignee}
                options={assigneeOptions}
                optionsLoading={labelOptionsLoading}
                saving={saving}
                onSave={onSaveAssignee}
              />
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <AssigneeAvatar login={issue.assignee} />
                {issue.assignee || t("issue.drawer.unassigned")}
              </span>
            )}
          </Field>
          <Field label={t("issue.summary.agent")}>
            {onSaveAgent ? (
              <InlineAgentEditor
                agent={issue.agentKind ?? null}
                effectiveAgent={effectiveAgent}
                options={agentOptions}
                optionsLoading={labelOptionsLoading}
                saving={saving}
                onSave={onSaveAgent}
              />
            ) : (
              <span className="inline-flex items-center gap-1.5">
                {issue.agentKind
                  ? agentKindLabel(issue.agentKind, t)
                  : t("issue.create.inherit", { agent: agentKindLabel(effectiveAgent, t) })}
              </span>
            )}
          </Field>
          {onSetParent ? (
            <Field label={t("issue.summary.relations.parent")}>
              <InlineIssuePicker
                value={issue.parentIdentifier ?? null}
                candidates={parentCandidates}
                title={t("issue.summary.relations.parentTitle")}
                placeholder={t("issue.summary.relations.noParent")}
                searchPlaceholder={t("issue.summary.relations.searchPlaceholder")}
                emptyLabel={t("issue.summary.relations.empty")}
                clearLabel={t("issue.summary.relations.clearParent")}
                saving={saving}
                onSelect={onSetParent}
                onClear={onClearParent}
              />
            </Field>
          ) : null}
          {onSetGroupLead ? (
            <Field label={t("issue.summary.relations.groupLead")}>
              <InlineIssuePicker
                value={issue.groupLeadIdentifier ?? null}
                candidates={groupLeadCandidates}
                title={t("issue.summary.relations.groupLeadTitle")}
                placeholder={t("issue.summary.relations.noGroupLead")}
                searchPlaceholder={t("issue.summary.relations.searchPlaceholder")}
                emptyLabel={t("issue.summary.relations.empty")}
                clearLabel={t("issue.summary.relations.clearGroupLead")}
                saving={saving}
                onSelect={onSetGroupLead}
                onClear={onClearGroupLead}
              />
            </Field>
          ) : null}
          <Field label={t("issue.summary.updated")}>
            <span className="text-muted-foreground">{formatDateTime(issue.updatedAt)}</span>
          </Field>
        </div>
        <Separator />
        <Field label={t("issue.summary.labels")}>
          {onSaveLabels ? (
            <InlineLabelEditor
              labels={issue.labels}
              options={labelOptions}
              optionsLoading={labelOptionsLoading}
              saving={saving}
              onSave={onSaveLabels}
            />
          ) : userVisibleLabels(issue.labels).length === 0 ? (
            <span className="text-xs text-muted-foreground">{t("issue.summary.noLabels")}</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {userVisibleLabels(issue.labels).map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-0.5 text-xs font-medium text-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </Field>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function selectPrimaryPreviewServer(servers: IssueDevServer[]): IssueDevServer | null {
  return servers.find((server) => server.primary) ?? servers.find((server) => server.status === "ready") ?? servers[0] ?? null;
}

function readyPreviewUrl(server: IssueDevServer | null): string | null {
  if (!server || server.status !== "ready" || !server.url) {
    return null;
  }

  return server.url;
}

function previewStatusLabel(
  data: IssueDevServersResponse | null,
  primaryServer: IssueDevServer | null,
  t: TFunction,
): string | null {
  if (!data || !primaryServer || shouldHideUnavailablePreview(data)) {
    return null;
  }

  switch (primaryServer.status) {
    case "pending":
    case "provisioning":
      return t("issue.summary.previewProvisioning");
    case "starting":
      return t("issue.summary.previewStarting");
    case "crashed":
      return t("issue.summary.previewCrashed");
    default:
      return null;
  }
}

function shouldHideUnavailablePreview(data: IssueDevServersResponse): boolean {
  if (data.available || data.servers.length > 0) {
    return false;
  }

  return data.reason === "disabled" || data.reason === "no_serve_step" || data.reason === "workspace_missing";
}
