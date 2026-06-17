import { Clock } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ASSIGNEE_PARAM,
  CREATOR_PARAM,
  filtersFromSearchParams,
  hasActiveFilters,
  RECENT_PARAM,
  SEARCH_PARAM,
  toggleListParam,
} from "@/lib/issueFilters";
import { peopleFromIssues, unassignedCount } from "@/lib/people";
import { cn } from "@/lib/utils";

import { PeopleMultiSelect } from "./PeopleMultiSelect";

const DEBOUNCE_MS = 250;
const RECENT_VALUE = "7d";

interface BoardFiltersDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focusSearch?: boolean;
}

export function BoardFiltersDrawer({ open, onOpenChange, focusSearch = false }: BoardFiltersDrawerProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { issues } = useWorkspace();

  const [searchDraft, setSearchDraft] = useState(searchParams.get(SEARCH_PARAM) ?? "");
  const debounceRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const assigneePeople = useMemo(() => peopleFromIssues(issues, "assignee"), [issues]);
  const creatorPeople = useMemo(() => peopleFromIssues(issues, "creator"), [issues]);
  const unassigned = useMemo(() => unassignedCount(issues), [issues]);

  useEffect(() => {
    setSearchDraft(searchParams.get(SEARCH_PARAM) ?? "");
  }, [searchParams]);

  useEffect(() => {
    if (open && focusSearch) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open, focusSearch]);

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

  function toggleParam(key: string, token: string) {
    setSearchParams((current) => toggleListParam(current, key, token), { replace: true });
  }

  function clearParam(key: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(key);
        return next;
      },
      { replace: true },
    );
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

  function clearFilters() {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.delete(SEARCH_PARAM);
        params.delete(ASSIGNEE_PARAM);
        params.delete(CREATOR_PARAM);
        params.delete(RECENT_PARAM);
        return params;
      },
      { replace: true },
    );
    setSearchDraft("");
  }

  const recentActive = filters.recentDays != null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full flex-col gap-6 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("board.filtersTitle")}</SheetTitle>
          <SheetDescription>{t("board.filtersDescription")}</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 overflow-visible">
          <div className="space-y-2">
            <Label>{t("board.searchLabel")}</Label>
            <Input
              data-testid="board-filters-search"
              ref={searchInputRef}
              value={searchDraft}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={t("board.searchPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("board.assignee")}</Label>
            <PeopleMultiSelect
              triggerLabel={t("board.assignee")}
              people={assigneePeople}
              selected={filters.assignees}
              onToggle={(token) => toggleParam(ASSIGNEE_PARAM, token)}
              onClear={() => clearParam(ASSIGNEE_PARAM)}
              includeMe
              includeUnassigned
              unassignedCount={unassigned}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("board.creator")}</Label>
            <PeopleMultiSelect
              triggerLabel={t("board.creator")}
              people={creatorPeople}
              selected={filters.creators}
              onToggle={(token) => toggleParam(CREATOR_PARAM, token)}
              onClear={() => clearParam(CREATOR_PARAM)}
              includeMe
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("board.recency")}</Label>
            <button
              type="button"
              aria-pressed={recentActive}
              onClick={toggleRecent}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                recentActive
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Clock className="h-3.5 w-3.5" /> {t("board.recentlyUpdated7d")}
            </button>
          </div>
        </div>

        <SheetFooter className="mt-auto flex flex-row items-center justify-between gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" disabled={!hasActiveFilters(filters)} onClick={clearFilters}>
            {t("board.clearAllFilters")}
          </Button>
          <SheetClose asChild>
            <Button size="sm">{t("board.done")}</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</span>;
}
