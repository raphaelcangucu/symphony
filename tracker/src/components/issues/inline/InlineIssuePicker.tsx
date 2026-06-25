import { Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { getStatusMeta } from "@/components/board/status-meta";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types/issue";

interface InlineIssuePickerProps {
  value: string | null;
  candidates: Issue[];
  title: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  clearLabel?: string;
  disabled?: boolean;
  saving?: boolean;
  onSelect: (identifier: string) => Promise<boolean>;
  onClear?: () => Promise<boolean>;
}

/**
 * Searchable popover to bind one issue to another (parent link, group lead).
 * Self-contained popover matching the other inline editors; resolves titles
 * from the loaded board list and falls back to the bare identifier when the
 * referenced issue is outside the current view.
 */
export function InlineIssuePicker({
  value,
  candidates,
  title,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  clearLabel,
  disabled = false,
  saving = false,
  onSelect,
  onClear,
}: InlineIssuePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const current = useMemo(
    () => candidates.find((candidate) => candidate.identifier === value) ?? null,
    [candidates, value],
  );

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      return undefined;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    window.addEventListener("mousedown", handlePointerDown);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const items = candidates.filter((candidate) => candidate.identifier !== value);
    if (!query) return items.slice(0, 50);
    return items
      .filter(
        (candidate) =>
          candidate.identifier.toLowerCase().includes(query) ||
          candidate.title.toLowerCase().includes(query),
      )
      .slice(0, 50);
  }, [candidates, searchQuery, value]);

  const handleSelect = useCallback(
    async (identifier: string) => {
      if (identifier === value) {
        setOpen(false);
        return;
      }
      const saved = await onSelect(identifier);
      if (saved) setOpen(false);
    },
    [onSelect, value],
  );

  const handleClear = useCallback(async () => {
    if (!onClear) return;
    const saved = await onClear();
    if (saved) setOpen(false);
  }, [onClear]);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled || saving}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "group inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-transparent px-1 py-1 text-left transition-colors",
            "hover:border-border/60 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
            open && "border-border/60 bg-muted/20",
            disabled ? "cursor-default opacity-70" : "cursor-pointer",
          )}
        >
          {value ? (
            <>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{value}</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {current?.title ?? t("issue.summary.relations.unavailable")}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">{placeholder}</span>
          )}
        </button>
        {value && onClear ? (
          <button
            type="button"
            disabled={disabled || saving}
            onClick={() => void handleClear()}
            aria-label={clearLabel ?? t("issue.summary.relations.clear")}
            title={clearLabel ?? t("issue.summary.relations.clear")}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute left-0 z-20 mt-2 w-72 overflow-hidden rounded-xl border border-border/70 bg-popover p-2 shadow-lg">
          <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </div>
          <div className="relative mb-2 px-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={searchQuery}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-8 w-full rounded-md border border-border/70 bg-background pl-8 pr-2.5 text-xs outline-none ring-0 focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {value && onClear && !searchQuery.trim() ? (
              <button
                type="button"
                onClick={() => void handleClear()}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
              >
                <X className="h-4 w-4 opacity-70" />
                {clearLabel ?? t("issue.summary.relations.clear")}
              </button>
            ) : null}
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">{emptyLabel}</p>
            ) : (
              filtered.map((candidate) => {
                const meta = getStatusMeta(candidate.status);
                const StatusIcon = meta.Icon;
                return (
                  <button
                    key={candidate.identifier}
                    type="button"
                    aria-pressed={candidate.identifier === value}
                    onClick={() => void handleSelect(candidate.identifier)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    <StatusIcon className={cn("h-4 w-4 shrink-0", meta.iconClass)} />
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{candidate.identifier}</span>
                    <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
