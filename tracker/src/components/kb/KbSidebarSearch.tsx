import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useKbSearch } from "@/hooks/useKbSearch";
import { cn } from "@/lib/utils";
import type { KbSearchResult } from "@/types/knowledgeBase";

interface Props {
  projectSlug: string;
  onSelect: (result: KbSearchResult) => void;
}

export function KbSidebarSearch({ projectSlug, onSelect }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { results, loading } = useKbSearch(projectSlug, query);

  const openSearch = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const handleSelect = (result: KbSearchResult) => {
    onSelect(result);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative px-2 pb-2">
      {!open ? (
        <button
          type="button"
          onClick={openSearch}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate text-left">{t("kb.search.label")}</span>
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
            {t("kb.search.shortcut")}
          </kbd>
        </button>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("kb.search.placeholder")}
            aria-label={t("kb.search.placeholder")}
            className="w-full rounded-md border-0 bg-accent/60 py-1.5 pl-8 pr-2 text-sm outline-none ring-1 ring-border focus:ring-ring"
          />
        </div>
      )}

      {open && query.trim().length >= 2 && (
        <div className="absolute left-2 right-2 top-full z-30 mt-1 overflow-hidden rounded-md border bg-popover shadow-md">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {loading ? t("kb.search.loading") : t("kb.search.empty")}
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {results.map((result) => (
                <li key={`${result.repoSlug}:${result.path}`}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-accent",
                    )}
                    onClick={() => handleSelect(result)}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-sm">{result.title}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{result.repoSlug}</span>
                    </span>
                    <span className="line-clamp-1 text-[11px] text-muted-foreground">{result.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
