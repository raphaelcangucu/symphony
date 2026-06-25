import { Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useKbSearch } from "@/hooks/useKbSearch";
import type { KbSearchResult } from "@/types/knowledgeBase";

interface Props {
  projectSlug: string;
  repo?: string;
  onSelect: (result: KbSearchResult) => void;
}

export function KbSearchBar({ projectSlug, repo, onSelect }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { results, loading } = useKbSearch(projectSlug, query, repo);

  const handleSelect = (result: KbSearchResult) => {
    onSelect(result);
    setQuery("");
  };

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("kb.search.placeholder")}
          className="pl-8"
          aria-label={t("kb.search.placeholder")}
        />
      </div>

      {query.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {loading ? t("kb.search.loading") : t("kb.search.empty")}
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((result) => (
                <li key={`${result.repoSlug}:${result.path}`}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent"
                    onClick={() => handleSelect(result)}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{result.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{result.repoSlug}</span>
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{result.snippet}</span>
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
