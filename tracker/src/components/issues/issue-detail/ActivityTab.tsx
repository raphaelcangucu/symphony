import { useEffect, useState } from "react";
import {
  ArrowRightLeft,
  CirclePlus,
  MessageSquare,
  Pencil,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

import { AgentStatusBadge } from "@/components/issues/AgentStatusBadge";
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

function eventMeta(event: ActivityEvent): EventMeta {
  const status = metaString(event.metadata, "status");
  switch (event.eventType) {
    case "issue_created":
      return { Icon: CirclePlus, className: "text-emerald-600 dark:text-emerald-400", summary: "Issue created" };
    case "issue_moved":
      return {
        Icon: ArrowRightLeft,
        className: "text-blue-600 dark:text-blue-400",
        summary: status ? `Moved to ${status}` : "Status changed",
      };
    case "issue_updated":
      return {
        Icon: Pencil,
        className: "text-muted-foreground",
        summary: status ? `Updated · ${status}` : "Issue updated",
      };
    case "comment_created":
      return { Icon: MessageSquare, className: "text-violet-600 dark:text-violet-400", summary: "Comment added" };
    case "blocker_changed":
      return { Icon: ShieldAlert, className: "text-amber-600 dark:text-amber-400", summary: "Blocker updated" };
    default:
      return { Icon: Pencil, className: "text-muted-foreground", summary: event.eventType.replaceAll("_", " ") };
  }
}

export function ActivityTab({ projectSlug, issue, execution }: ActivityTabProps) {
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
        No activity recorded yet for {issue.identifier}. Tracker events appear here as the issue moves, gets comments,
        or is worked on.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {execution ? (
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
          <AgentStatusBadge status={execution.status} />
          <div className="min-w-0 text-xs text-muted-foreground">
            {execution.lastMessage || execution.lastEvent || "Agent is attached to this issue."}
            {execution.lastEventAt ? (
              <span className="ml-1">· {formatDateTime(execution.lastEventAt)}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {events.length > 0 ? (
        <ol className="relative space-y-4 border-l pl-5">
          {events.map((event) => {
            const meta = eventMeta(event);
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
