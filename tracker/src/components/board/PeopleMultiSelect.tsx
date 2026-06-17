import { Check, ChevronDown, UserRound, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ME_TOKEN, UNASSIGNED_TOKEN } from "@/lib/issueFilters";
import type { PersonFacet } from "@/lib/people";
import { cn } from "@/lib/utils";

interface PeopleMultiSelectProps {
  triggerLabel: string;
  people: PersonFacet[];
  selected: string[];
  onToggle: (token: string) => void;
  onClear?: () => void;
  includeMe?: boolean;
  includeUnassigned?: boolean;
  unassignedCount?: number;
  align?: "left" | "right";
  className?: string;
}

export function PeopleMultiSelect({
  triggerLabel,
  people,
  selected,
  onToggle,
  onClear,
  includeMe = false,
  includeUnassigned = false,
  unassignedCount = 0,
  align = "left",
  className,
}: PeopleMultiSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const namedSelected = useMemo(
    () => selected.filter((token) => token !== ME_TOKEN && token !== UNASSIGNED_TOKEN),
    [selected],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return people;
    return people.filter((person) => person.value.toLowerCase().includes(term));
  }, [people, query]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = selected.length;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className={cn("gap-1.5 rounded-full", count > 0 && "border-primary/40 bg-primary/5")}
      >
        <UserRound className="h-3.5 w-3.5" />
        <span>{triggerLabel}</span>
        {count > 0 ? (
          <span className="flex items-center gap-0.5">
            <span className="-mr-1 flex">
              {namedSelected.slice(0, 3).map((value) => (
                <AssigneeAvatar key={value} login={value} className="ring-2 ring-background" />
              ))}
            </span>
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {count}
            </span>
          </span>
        ) : (
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        )}
      </Button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          className={cn(
            "absolute z-50 mt-2 w-72 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <div className="border-b p-2">
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("board.people.searchPlaceholder", { label: triggerLabel.toLowerCase() })}
              className="h-8"
            />
          </div>

          <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
            {includeMe ? (
              <OptionRow
                label={t("board.people.assignedToMe")}
                active={selectedSet.has(ME_TOKEN)}
                onClick={() => onToggle(ME_TOKEN)}
                leading={<UserRound className="h-4 w-4 text-primary" />}
              />
            ) : null}
            {includeUnassigned ? (
              <OptionRow
                label={t("board.unassigned")}
                count={unassignedCount}
                active={selectedSet.has(UNASSIGNED_TOKEN)}
                onClick={() => onToggle(UNASSIGNED_TOKEN)}
                leading={
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-[9px] text-muted-foreground">
                    ?
                  </span>
                }
              />
            ) : null}
            {(includeMe || includeUnassigned) && filtered.length > 0 ? (
              <div className="my-1 h-px bg-border" />
            ) : null}

            {filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("board.people.noPeopleFound")}</p>
            ) : (
              filtered.map((person) => (
                <OptionRow
                  key={person.value}
                  label={person.value}
                  count={person.count}
                  active={selectedSet.has(person.value)}
                  onClick={() => onToggle(person.value)}
                  leading={<AssigneeAvatar login={person.value} />}
                />
              ))
            )}
          </div>

          {count > 0 && onClear ? (
            <div className="flex items-center justify-between border-t px-2 py-1.5">
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onClear}>
                <X className="h-3 w-3" /> {t("board.clear")}
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
                {t("board.done")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface OptionRowProps {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  leading: ReactNode;
}

function OptionRow({ label, count, active, onClick, leading }: OptionRowProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60",
        active && "bg-primary/10",
      )}
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === "number" ? (
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      ) : null}
      <Check className={cn("h-4 w-4 text-primary transition-opacity", active ? "opacity-100" : "opacity-0")} />
    </button>
  );
}
