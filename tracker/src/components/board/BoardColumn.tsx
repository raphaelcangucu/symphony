import { useDroppable } from "@dnd-kit/core";
import { SortableContext, type SortingStrategy } from "@dnd-kit/sortable";
import { Gauge, MoreHorizontal, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AgentStatusDot } from "@/components/issues/AgentStatusBadge";
import { NewIssueMenu } from "@/components/issues/NewIssueMenu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { WorkflowStatusCategory, WorkflowStatusName } from "@/types/workflow-status";

import { GroupCard } from "./GroupCard";
import { IssueCard } from "./IssueCard";
import { SubtaskParentCard } from "./SubtaskParentCard";
import { groupIssuesIntoUnits, type DropIndicator } from "./board-utils";
import { getStatusMeta } from "./status-meta";

/**
 * Keeps cards fixed in place during a drag (no shuffle to "make room"). A
 * stationary column means the card under the pointer is always the one the user
 * is aiming at, which is what makes drag-to-group reliable and keeps it visually
 * distinct from reordering (shown via an explicit drop line instead).
 */
const noShiftStrategy: SortingStrategy = () => null;

interface BoardColumnProps {
  status: WorkflowStatusName;
  category?: WorkflowStatusCategory | null;
  issues: Issue[];
  onSelectIssue: (issue: Issue) => void;
  projectSlug: string;
  statuses?: readonly WorkflowStatusName[];
  onIssueCreated?: (issue: Issue) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  agentExecutions?: ReadonlyMap<string, AgentExecution>;
  limit?: number;
  onChangeLimit?: (status: WorkflowStatusName, limit: number | null) => void;
  /** True while a card is being dragged anywhere on the board. */
  dragActive?: boolean;
  onRemoveMember: (identifier: string) => void;
  onDisband: (leadIdentifier: string) => void;
  mergeTargetId?: string | null;
  dropIndicator?: DropIndicator | null;
}

export function BoardColumn({
  status,
  category,
  issues,
  onSelectIssue,
  projectSlug,
  statuses,
  onIssueCreated,
  collapsed,
  onToggleCollapse,
  agentExecutions,
  limit,
  onChangeLimit,
  dragActive = false,
  onRemoveMember,
  onDisband,
  mergeTargetId = null,
  dropIndicator = null,
}: BoardColumnProps) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const meta = getStatusMeta(status, category);
  const Icon = meta.Icon;
  const units = groupIssuesIntoUnits(issues);

  const [limitOpen, setLimitOpen] = useState(false);
  const [limitDraft, setLimitDraft] = useState("");

  const overLimit = typeof limit === "number" && issues.length > limit;
  const atLimit = typeof limit === "number" && issues.length === limit;

  const activeAgent = issues
    .map((issue) => agentExecutions?.get(issue.identifier))
    .find((agent) => agent?.status === "live" || agent?.status === "waiting");

  function openLimitDialog() {
    setLimitDraft(typeof limit === "number" ? String(limit) : "");
    setLimitOpen(true);
  }

  function saveLimit() {
    const parsed = Number.parseInt(limitDraft, 10);
    onChangeLimit?.(status, Number.isFinite(parsed) && parsed > 0 ? parsed : null);
    setLimitOpen(false);
  }

  const countBadge = (
    <span
      className={cn(
        "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
        overLimit
          ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
          : atLimit
            ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
            : "bg-muted text-muted-foreground",
      )}
    >
      {typeof limit === "number" ? `${issues.length}/${limit}` : issues.length}
    </span>
  );

  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        className={cn(
          "flex h-full w-12 shrink-0 flex-col items-center gap-3 rounded-2xl border border-border/60 py-3 transition-colors",
          meta.surfaceClass,
          isOver && "border-primary/50 ring-2 ring-primary/15",
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={t("board.column.expandAria", { status })}
          title={t("board.column.expandTitle", { status })}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <Icon className={cn("h-4 w-4", meta.iconClass)} />
        {countBadge}
        {activeAgent ? <AgentStatusDot status={activeAgent.status} /> : null}
        <span
          className="mt-1 flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          style={{ writingMode: "vertical-rl" }}
        >
          {status}
        </span>
      </section>
    );
  }

  return (
    <section className="flex h-full w-80 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", meta.iconClass)} />
          <h2 className="truncate text-sm font-semibold text-foreground">{status}</h2>
          {countBadge}
          {activeAgent ? <AgentStatusDot status={activeAgent.status} className="ml-0.5" /> : null}
        </div>
        <div className="flex items-center gap-0.5">
          <NewIssueMenu
            projectSlug={projectSlug}
            status={status}
            statuses={statuses}
            onCreated={onIssueCreated}
            variant="icon"
            className="shrink-0"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("board.column.optionsAria", { status })}
                title={t("board.column.optionsTitle")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={onToggleCollapse}>
                <PanelLeftClose className="mr-2 h-4 w-4" />
                {t("board.column.collapse")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={openLimitDialog}>
                <Gauge className="mr-2 h-4 w-4" />
                {typeof limit === "number" ? t("board.column.editWipLimit") : t("board.column.setWipLimit")}
              </DropdownMenuItem>
              {typeof limit === "number" ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => onChangeLimit?.(status, null)}
                >
                  {t("board.column.clearLimit")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        ref={setNodeRef}
        data-board-column-scroll
        className={cn(
          "scrollbar-discrete relative min-h-80 flex-1 overflow-y-auto rounded-2xl border border-border/60 p-2.5 transition-colors",
          meta.surfaceClass,
          overLimit && "border-rose-500/40 ring-1 ring-rose-500/20",
          isOver && "border-primary/50 ring-2 ring-primary/15",
        )}
      >
        <span className={cn("absolute inset-x-3 top-0 h-0.5 rounded-full", overLimit ? "bg-rose-500/70" : meta.accentClass)} />
        <SortableContext items={units.map((unit) => unit.id)} strategy={noShiftStrategy}>
          <div className="space-y-2.5 pt-1">
            {units.map((unit) =>
              unit.kind === "group" ? (
                <GroupCard
                  key={unit.id}
                  id={unit.id}
                  lead={unit.lead}
                  members={unit.members}
                  onSelectIssue={onSelectIssue}
                  onRemoveMember={onRemoveMember}
                  onDisband={onDisband}
                  agentExecutions={agentExecutions}
                  mergeActive={mergeTargetId === unit.id}
                  dropEdge={dropIndicator?.unitId === unit.id ? dropIndicator.edge : null}
                />
              ) : unit.kind === "parent" ? (
                <SubtaskParentCard
                  key={unit.id}
                  id={unit.id}
                  issue={unit.issue}
                  subtasks={unit.subtasks}
                  onSelectIssue={onSelectIssue}
                  agent={agentExecutions?.get(unit.issue.identifier)}
                  mergeActive={mergeTargetId === unit.id}
                  dropEdge={dropIndicator?.unitId === unit.id ? dropIndicator.edge : null}
                />
              ) : (
                <IssueCard
                  key={unit.id}
                  issue={unit.issue}
                  onSelect={onSelectIssue}
                  agent={agentExecutions?.get(unit.issue.identifier)}
                  mergeActive={mergeTargetId === unit.id}
                  dropEdge={dropIndicator?.unitId === unit.id ? dropIndicator.edge : null}
                />
              ),
            )}
          </div>
        </SortableContext>
        {issues.length === 0 && !dragActive ? (
          <NewIssueMenu
            projectSlug={projectSlug}
            status={status}
            statuses={statuses}
            onCreated={onIssueCreated}
            variant="dashed"
            className="mt-1"
          />
        ) : null}
      </div>

      <Dialog open={limitOpen} onOpenChange={setLimitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("board.column.wipDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("board.column.wipDialogDescription", { status })}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={limitDraft}
            onChange={(event) => setLimitDraft(event.target.value)}
            placeholder={t("board.column.wipPlaceholder")}
            inputMode="numeric"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") saveLimit();
            }}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setLimitOpen(false)}>
              {t("issue.comments.cancel")}
            </Button>
            <Button type="button" onClick={saveLimit}>
              {t("issue.comments.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
