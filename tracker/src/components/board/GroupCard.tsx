import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, Layers, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

import { GroupDropOverlay, ReorderDropLine } from "./GroupDropOverlay";
import { IssueCard } from "./IssueCard";

interface GroupCardProps {
  id: string;
  lead: Issue;
  members: Issue[];
  onSelectIssue: (issue: Issue) => void;
  onRemoveMember: (identifier: string) => void;
  onDisband: (leadIdentifier: string) => void;
  agentExecutions?: ReadonlyMap<string, AgentExecution>;
  mergeActive?: boolean;
  dropEdge?: "top" | "bottom" | null;
}

export function GroupCard({
  id,
  lead,
  members,
  onSelectIssue,
  onRemoveMember,
  onDisband,
  agentExecutions,
  mergeActive = false,
  dropEdge = null,
}: GroupCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: "none",
  } satisfies React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative rounded-xl border border-border/70 bg-muted/30 p-1.5 shadow-sm transition-all",
        isDragging && "opacity-40",
        mergeActive && "border-primary ring-2 ring-primary ring-offset-1 ring-offset-background",
      )}
      {...attributes}
      {...listeners}
    >
      {mergeActive ? <GroupDropOverlay /> : null}
      {dropEdge && !mergeActive ? <ReorderDropLine edge={dropEdge} /> : null}
      <div className="mb-1 flex items-center justify-between px-1 pt-0.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          title={expanded ? t("board.group.collapse") : t("board.group.expand")}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Layers className="h-3 w-3" />
          {t("board.group.count", { count: members.length })}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDisband(lead.identifier);
          }}
          className="text-[10px] font-medium text-muted-foreground hover:text-destructive"
        >
          {t("board.group.disband")}
        </button>
      </div>

      <IssueCard issue={lead} onSelect={onSelectIssue} agent={agentExecutions?.get(lead.identifier)} presentational />

      {expanded ? (
        <div className="mt-1.5 space-y-1 border-l-2 border-border/60 pl-2">
          {members.map((member) => (
            <div
              key={member.identifier}
              className="flex items-center justify-between gap-2 rounded-md bg-card px-2 py-1 text-xs"
            >
              <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onSelectIssue(member)}>
                <span className="font-mono text-[10px] text-muted-foreground">{member.identifier}</span>{" "}
                <span className="truncate">{member.title}</span>
              </button>
              <button
                type="button"
                aria-label={t("board.group.removeMember", { identifier: member.identifier })}
                title={t("board.group.removeMember", { identifier: member.identifier })}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveMember(member.identifier);
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
