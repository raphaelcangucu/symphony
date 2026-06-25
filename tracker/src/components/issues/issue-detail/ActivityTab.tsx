import { useEffect, useState } from "react";
import {
  ArrowRightLeft,
  CirclePlus,
  MessageSquare,
  Pencil,
  RotateCcw,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { AgentStatusBadge } from "@/components/issues/AgentStatusBadge";
import { i18n } from "@/i18n";
import { cn, formatDateTime } from "@/lib/utils";
import { listActivityEvents } from "@/services/activity";
import type { ActivityEvent } from "@/types/activity";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

interface ActivityTabProps {
  projectSlug: string;
  issue: Issue;
  execution?: AgentExecution;
}

interface EventMeta {
  Icon: LucideIcon;
  className: string;
  summary: string;
}

function metaString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function agentDispatchSummary(action: string | null, t: TFunction): string {
  if (action === "restart") return t("issue.activity.events.agentRestartRequested");
  if (action === "hard_reset") return t("issue.activity.events.agentHardResetRequested");
  return t("issue.activity.events.agentDispatchRequested");
}

function eventMeta(event: ActivityEvent, t: TFunction = i18n.t.bind(i18n) as TFunction): EventMeta {
  const status = metaString(event.metadata, "status");
  switch (event.eventType) {
    case "issue_created":
      return {
        Icon: CirclePlus,
        className: "text-emerald-600 dark:text-emerald-400",
        summary: t("issue.activity.events.issueCreated"),
      };
    case "issue_moved":
      return {
        Icon: ArrowRightLeft,
        className: "text-blue-600 dark:text-blue-400",
        summary: status ? t("issue.activity.events.movedTo", { status }) : t("issue.activity.events.statusChanged"),
      };
    case "issue_updated":
      return {
        Icon: Pencil,
        className: "text-muted-foreground",
        summary: status ? t("issue.activity.events.updated", { status }) : t("issue.activity.events.issueUpdated"),
      };
    case "comment_created":
      return {
        Icon: MessageSquare,
        className: "text-violet-600 dark:text-violet-400",
        summary: t("issue.activity.events.commentAdded"),
      };
    case "blocker_changed":
      return {
        Icon: ShieldAlert,
        className: "text-amber-600 dark:text-amber-400",
        summary: t("issue.activity.events.blockerUpdated"),
      };
    case "agent_dispatch_requested":
      return {
        Icon: RotateCcw,
        className: "text-cyan-600 dark:text-cyan-400",
        summary: agentDispatchSummary(metaString(event.metadata, "action"), t),
      };
    default:
      return {
        Icon: Pencil,
        className: "text-muted-foreground",
        summary: event.eventType.replaceAll("_", " "),
      };
  }
}

export function ActivityTab({ projectSlug, issue, execution }: ActivityTabProps) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    void listActivityEvents(projectSlug, issue.identifier)
      .then((items) => {
        if (active) setEvents(items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [issue.identifier, projectSlug]);

  const hasContent = Boolean(execution) || events.length > 0;

  if (loaded && !hasContent) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        {t("issue.activity.empty", { identifier: issue.identifier })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {execution ? (
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
          <AgentStatusBadge status={execution.status} />
          <div className="min-w-0 text-xs text-muted-foreground">
            {execution.lastMessage || execution.lastEvent || t("issue.activity.agentAttached")}
            {execution.lastEventAt ? (
              <span className="ml-1">· {formatDateTime(execution.lastEventAt)}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {events.length > 0 ? (
        <ol className="relative space-y-4 border-l pl-5">
          {events.map((event) => {
            const meta = eventMeta(event, t);
            const Icon = meta.Icon;
            return (
              <li key={event.id} className="relative">
                <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full border bg-background">
                  <Icon className={cn("h-3 w-3", meta.className)} />
                </span>
                <p className="text-sm font-medium">{meta.summary}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(event.insertedAt)}</p>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
