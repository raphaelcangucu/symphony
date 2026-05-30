import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useViewer } from "@/components/auth/ViewerProvider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const DEBOUNCE_MS = 250;

interface BoardFiltersDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knownLogins?: string[];
  focusSearch?: boolean;
}

export function BoardFiltersDrawer({ open, onOpenChange, knownLogins = [], focusSearch = false }: BoardFiltersDrawerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { viewer, status } = useViewer();
  const viewerLogin = viewer?.githubLogin ?? null;

  const [searchDraft, setSearchDraft] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSearchDraft(searchParams.get("q") ?? "");
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
        if (trimmed) params.set("q", trimmed);
        else params.delete("q");
        return params;
      },
      { replace: true },
    );
  }

  function setFilter(key: "assignee" | "creator", value: string | null) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (value) params.set(key, value);
        else params.delete(key);
        return params;
      },
      { replace: true },
    );
  }

  function clearFilters() {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.delete("q");
        params.delete("assignee");
        params.delete("creator");
        return params;
      },
      { replace: true },
    );
    setSearchDraft("");
  }

  function onSearchChange(value: string) {
    setSearchDraft(value);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => commitSearch(value), DEBOUNCE_MS);
  }

  const showViewerOptions = status === "ready" && viewerLogin;
  const assignee = searchParams.get("assignee");
  const creator = searchParams.get("creator");
  const hasAny = Boolean(searchDraft) || Boolean(assignee) || Boolean(creator);
  const logins = useMemo(() => Array.from(new Set(knownLogins.filter(Boolean))).sort(), [knownLogins]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full flex-col gap-6 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Search and narrow issues by assignee or creator.</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 overflow-auto">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Search</label>
            <Input
              data-testid="board-filters-search"
              ref={searchInputRef}
              value={searchDraft}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search issues..."
            />
          </div>

          <FilterSection
            label="Assignee"
            currentValue={assignee}
            viewerLogin={showViewerOptions ? viewerLogin : null}
            logins={logins}
            onSelect={(value) => setFilter("assignee", value)}
            onClear={() => setFilter("assignee", null)}
          />

          <FilterSection
            label="Creator"
            currentValue={creator}
            viewerLogin={showViewerOptions ? viewerLogin : null}
            logins={logins}
            onSelect={(value) => setFilter("creator", value)}
            onClear={() => setFilter("creator", null)}
          />
        </div>

        <SheetFooter className="mt-auto flex flex-row items-center justify-between gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" disabled={!hasAny} onClick={clearFilters}>
            Clear all filters
          </Button>
          <SheetClose asChild>
            <Button size="sm">Done</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

interface FilterSectionProps {
  label: "Assignee" | "Creator";
  currentValue: string | null;
  viewerLogin: string | null;
  logins: string[];
  onSelect: (value: string) => void;
  onClear: () => void;
}

function FilterSection({ label, currentValue, viewerLogin, logins, onSelect, onClear }: FilterSectionProps) {
  const renderLabel = currentValue ? `${label}: ${currentValue === "me" ? "Me" : currentValue}` : `${label}: Any`;

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-start">
            {renderLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onClear()}>Any</DropdownMenuItem>
          {viewerLogin ? <DropdownMenuItem onSelect={() => onSelect("me")}>Me</DropdownMenuItem> : null}
          <DropdownMenuSeparator />
          {logins.length === 0 ? (
            <DropdownMenuItem disabled>No known logins</DropdownMenuItem>
          ) : (
            logins.map((login) => (
              <DropdownMenuItem key={login} onSelect={() => onSelect(login)}>
                @{login}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
