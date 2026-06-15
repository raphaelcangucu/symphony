import { Check, Clock, ListFilter, Search, UserRound, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ASSIGNEE_PARAM,
  CREATOR_PARAM,
  filtersFromSearchParams,
  ME_TOKEN,
  RECENT_PARAM,
  SEARCH_PARAM,
  toggleListParam,
  UNASSIGNED_TOKEN,
} from "@/lib/issueFilters";
import { peopleFromIssues, unassignedCount } from "@/lib/people";
import { cn } from "@/lib/utils";

import { PeopleMultiSelect } from "./PeopleMultiSelect";

const QUICK_AVATARS = 8;
const DEBOUNCE_MS = 250;
const RECENT_VALUE = "7d";

export function BoardQuickFilters() {
  const { issues } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(searchParams.get(SEARCH_PARAM) ?? "");
  const debounceRef = useRef<number | null>(null);

  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);

  useEffect(() => {
    setSearchDraft(searchParams.get(SEARCH_PARAM) ?? "");
  }, [searchParams]);
  const people = useMemo(() => peopleFromIssues(issues, "assignee"), [issues]);
  const unassigned = useMemo(() => unassignedCount(issues), [issues]);

  const assignees = filters.assignees;
  const assigneeSet = useMemo(() => new Set(assignees), [assignees]);
  const meActive = assigneeSet.has(ME_TOKEN);
  const unassignedActive = assigneeSet.has(UNASSIGNED_TOKEN);
  const recentActive = filters.recentDays != null;
  const searchActive = Boolean(filters.search);
  const anyActive = assignees.length > 0 || filters.creators.length > 0 || recentActive || searchActive;

  function commitSearch(next: string) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        const trimmed = next.trim();
        if (trimmed) params.set(SEARCH_PARAM, trimmed);
        else params.delete(SEARCH_PARAM);
        return params;
      },
      { replace: true },
    );
  }

  function onSearchChange(value: string) {
    setSearchDraft(value);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => commitSearch(value), DEBOUNCE_MS);
  }

  function toggleAssignee(token: string) {
    setSearchParams((current) => toggleListParam(current, ASSIGNEE_PARAM, token), { replace: true });
  }

  function toggleRecent() {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (next.has(RECENT_PARAM)) next.delete(RECENT_PARAM);
        else next.set(RECENT_PARAM, RECENT_VALUE);
        return next;
      },
      { replace: true },
    );
  }

  function clearAssignees() {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(ASSIGNEE_PARAM);
        return next;
      },
      { replace: true },
    );
  }

  function clearAll() {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(SEARCH_PARAM);
        next.delete(ASSIGNEE_PARAM);
        next.delete(CREATOR_PARAM);
        next.delete(RECENT_PARAM);
        return next;
      },
      { replace: true },
    );
    setSearchDraft("");
  }

  const quickPeople = people.slice(0, QUICK_AVATARS);

  return (
    <div className="relative z-30 flex flex-wrap items-center gap-2 border-b border-border/60 bg-background/70 px-6 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/50">
      <span className="mr-1 hidden items-center gap-1.5 text-xs font-medium text-muted-foreground sm:flex">
        <ListFilter className="h-3.5 w-3.5" />
        Quick filters
      </span>

      <div className="relative w-full min-w-0 sm:w-44 md:w-52">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          data-testid="board-quick-filters-search"
          value={searchDraft}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search issues..."
          aria-label="Search issues"
          className={cn(
            "h-8 pl-8 pr-8 text-sm",
            searchActive && "border-primary/40 bg-primary/5",
          )}
        />
        {searchDraft ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setSearchDraft("");
              if (debounceRef.current) window.clearTimeout(debounceRef.current);
              commitSearch("");
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground transition hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {quickPeople.length > 0 ? (
        <div className="flex items-center">
          {quickPeople.map((person) => {
            const active = assigneeSet.has(person.value);
            return (
              <button
                key={person.value}
                type="button"
                title={`${person.value} · ${person.count} issue${person.count === 1 ? "" : "s"}`}
                aria-pressed={active}
                onClick={() => toggleAssignee(person.value)}
                className={cn(
                  "relative -ml-1.5 rounded-full transition first:ml-0 hover:z-10",
                  active
                    ? "z-10 ring-2 ring-primary ring-offset-1 ring-offset-background"
                    : "opacity-70 ring-1 ring-background hover:opacity-100",
                )}
              >
                <AssigneeAvatar login={person.value} size="md" />
                {active ? (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <PeopleMultiSelect
        triggerLabel="Assignee"
        people={people}
        selected={assignees}
        onToggle={toggleAssignee}
        onClear={clearAssignees}
        includeMe
        includeUnassigned
        unassignedCount={unassigned}
      />

      <span className="mx-1 hidden h-5 w-px bg-border sm:block" />

      <Chip active={meActive} onClick={() => toggleAssignee(ME_TOKEN)} icon={<UserRound className="h-4 w-4" />}>
        Assigned to me
      </Chip>
      <Chip
        active={unassignedActive}
        onClick={() => toggleAssignee(UNASSIGNED_TOKEN)}
        icon={
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-dashed border-current text-[9px]">
            ?
          </span>
        }
      >
        Unassigned
      </Chip>
      <Chip active={recentActive} onClick={toggleRecent} icon={<Clock className="h-4 w-4" />}>
        Recently updated
      </Chip>

      {anyActive ? (
        <Button variant="ghost" size="sm" className="ml-auto" onClick={clearAll}>
          <X className="h-4 w-4" /> Clear
        </Button>
      ) : null}
    </div>
  );
}

interface ChipProps {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
}

function Chip({ active, onClick, icon, children }: ChipProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        active
          ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
          : "text-muted-foreground",
      )}
    >
      {icon}
      {children}
    </Button>
  );
}
