import { SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  defaultSidebarPreferences,
  migrateSidebarPreferences,
  type SidebarFilterAgent,
  type SidebarGroupMode,
  type SidebarPreferences,
} from "@/lib/sidebarPreferences";
import type {
  SidebarNode,
  SidebarSessionNode,
  SidebarSortMode,
} from "@/types/sidebar";

const STATUS_OPTIONS = ["active", "attention", "error", "idle", "stale"] as const;
const AGENT_OPTIONS: readonly SidebarFilterAgent[] = [
  "codex",
  "claude",
  "cursor",
  "opencode",
];

export type SidebarFilterAction =
  | { readonly type: "sort"; readonly value: SidebarSortMode }
  | { readonly type: "group"; readonly value: SidebarGroupMode }
  | { readonly type: "toggle-status"; readonly value: string }
  | { readonly type: "toggle-agent"; readonly value: SidebarFilterAgent }
  | { readonly type: "toggle-activity" }
  | { readonly type: "toggle-archived" }
  | { readonly type: "reset-filters" }
  | { readonly type: "collapse-all" }
  | {
      readonly type: "mark-visible-read";
      readonly visibleNodes: readonly SidebarNode[];
      readonly timestamp: string;
    };

export interface SidebarFiltersMenuProps {
  readonly preferences: unknown;
  readonly visibleNodes: readonly SidebarNode[];
  readonly now?: () => string;
  updatePreferences(
    updater: (current: SidebarPreferences) => SidebarPreferences,
  ): void;
}

export function applySidebarFilterAction(
  current: unknown,
  action: SidebarFilterAction,
): SidebarPreferences {
  const preferences = migrateSidebarPreferences(current);

  switch (action.type) {
    case "sort":
      return { ...preferences, sort: action.value };
    case "group":
      return { ...preferences, group: action.value };
    case "toggle-status":
      return {
        ...preferences,
        filters: {
          ...preferences.filters,
          statuses: toggled(preferences.filters.statuses, action.value),
        },
      };
    case "toggle-agent":
      return {
        ...preferences,
        filters: {
          ...preferences.filters,
          agents: toggled(preferences.filters.agents, action.value),
        },
      };
    case "toggle-activity":
      return {
        ...preferences,
        filters: {
          ...preferences.filters,
          activityOnly: !preferences.filters.activityOnly,
        },
      };
    case "toggle-archived":
      return {
        ...preferences,
        filters: {
          ...preferences.filters,
          showArchived: !preferences.filters.showArchived,
        },
      };
    case "reset-filters":
      return {
        ...preferences,
        filters: { ...defaultSidebarPreferences().filters },
      };
    case "collapse-all":
      return {
        ...preferences,
        expandedProjectIds: [],
        expandedWorkspaceIds: [],
        revealedProjectIds: [],
        revealedWorkspaceIds: [],
      };
    case "mark-visible-read":
      return markVisibleRead(preferences, action.visibleNodes, action.timestamp);
  }
}

export function SidebarFiltersMenu({
  preferences,
  visibleNodes,
  now = () => new Date().toISOString(),
  updatePreferences,
}: SidebarFiltersMenuProps) {
  const { t } = useTranslation();
  const normalized = migrateSidebarPreferences(preferences);
  const activeCount =
    normalized.filters.statuses.length +
    normalized.filters.agents.length +
    Number(normalized.filters.activityOnly) +
    Number(normalized.filters.showArchived);

  function apply(action: SidebarFilterAction) {
    updatePreferences((current) => applySidebarFilterAction(current, action));
  }

  function markRead() {
    const timestamp = now();
    if (!isValidIsoTimestamp(timestamp)) {
      throw new TypeError("SidebarFiltersMenu now() must return a valid ISO timestamp");
    }
    apply({ type: "mark-visible-read", visibleNodes, timestamp });
  }

  const buttonLabel =
    activeCount > 0
      ? `${t("layout.sidebar.filters.button")}, ${t("layout.sidebar.filters.activeCount", {
          count: activeCount,
        })}`
      : t("layout.sidebar.filters.button");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={buttonLabel}
          className="h-7 gap-1.5 px-2 text-xs"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          {t("layout.sidebar.filters.button")}
          {activeCount > 0 ? (
            <span aria-hidden className="rounded bg-muted px-1 text-[10px]">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t("layout.sidebar.filters.sort")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={normalized.sort}
            >
              <DropdownMenuRadioItem
                value="activity"
                onSelect={() => apply({ type: "sort", value: "activity" })}
              >
                {t("layout.sidebar.filters.sortActivity")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="name"
                onSelect={() => apply({ type: "sort", value: "name" })}
              >
                {t("layout.sidebar.filters.sortName")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t("layout.sidebar.filters.group")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={normalized.group}
            >
              <DropdownMenuRadioItem
                value="none"
                onSelect={() => apply({ type: "group", value: "none" })}
              >
                {t("layout.sidebar.filters.groupNone")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="workspaceKind"
                onSelect={() => apply({ type: "group", value: "workspaceKind" })}
              >
                {t("layout.sidebar.filters.groupWorkspaceKind")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="status"
                onSelect={() => apply({ type: "group", value: "status" })}
              >
                {t("layout.sidebar.filters.groupStatus")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t("layout.sidebar.filters.statuses")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {STATUS_OPTIONS.map((status) => (
              <DropdownMenuCheckboxItem
                key={status}
                checked={normalized.filters.statuses.includes(status)}
                onCheckedChange={() => apply({ type: "toggle-status", value: status })}
              >
                {t(`layout.sidebar.tree.aggregateStatus.${status}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t("layout.sidebar.filters.agents")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {AGENT_OPTIONS.map((agent) => (
              <DropdownMenuCheckboxItem
                key={agent}
                checked={normalized.filters.agents.includes(agent)}
                onCheckedChange={() => apply({ type: "toggle-agent", value: agent })}
              >
                {t(`assistant.catalog.agents.${agent}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={normalized.filters.activityOnly}
          onCheckedChange={() => apply({ type: "toggle-activity" })}
        >
          {t("layout.sidebar.filters.activityOnly")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={normalized.filters.showArchived}
          onCheckedChange={() => apply({ type: "toggle-archived" })}
        >
          {t("layout.sidebar.filters.showArchived")}
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => apply({ type: "reset-filters" })}>
          {t("layout.sidebar.filters.reset")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => apply({ type: "collapse-all" })}>
          {t("layout.sidebar.filters.collapseAll")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={markRead}>
          {t("layout.sidebar.filters.markRead")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function toggled<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function markVisibleRead(
  preferences: SidebarPreferences,
  visibleNodes: readonly SidebarNode[],
  timestamp: string,
): SidebarPreferences {
  if (!isValidIsoTimestamp(timestamp)) {
    throw new TypeError("mark-visible-read requires a valid ISO timestamp");
  }
  const nextReadMap = { ...preferences.lastReadAtBySession };
  for (const session of visibleSessions(visibleNodes)) {
    if (session.sessionKind !== "execution") nextReadMap[session.id] = timestamp;
  }
  return { ...preferences, lastReadAtBySession: nextReadMap };
}

function visibleSessions(nodes: readonly SidebarNode[]): SidebarSessionNode[] {
  const sessions: SidebarSessionNode[] = [];
  const seen = new Set<string>();

  function add(session: SidebarSessionNode) {
    if (seen.has(session.id)) return;
    seen.add(session.id);
    sessions.push(session);
  }

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || typeof node !== "object") continue;
    if (node.kind === "session") {
      add(node);
      continue;
    }
    if (node.kind === "workspace") {
      for (const session of [...node.sessions, ...node.overflowSessions]) add(session);
      continue;
    }
    if (node.kind === "project") {
      for (const session of node.unassignedSessions) add(session);
      for (const workspace of [...node.workspaces, ...node.overflowWorkspaces]) {
        for (const session of [...workspace.sessions, ...workspace.overflowSessions]) {
          add(session);
        }
      }
    }
  }
  return sessions;
}

function isValidIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
