import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface BranchAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: readonly string[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

export function BranchAutocomplete({
  value,
  onChange,
  suggestions,
  placeholder,
  disabled = false,
  loading = false,
  className,
  id,
  "aria-label": ariaLabel,
}: BranchAutocompleteProps) {
  const { t } = useTranslation();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const options = useMemo(() => {
    const query = value.trim();
    const unique = [...new Set(suggestions.map((item) => item.trim()).filter(Boolean))];
    const filtered = query
      ? unique.filter((item) => item.toLowerCase().includes(query.toLowerCase()))
      : unique;

    if (query && !filtered.some((item) => item.toLowerCase() === query.toLowerCase())) {
      return [query, ...filtered];
    }

    return filtered;
  }, [suggestions, value]);

  useEffect(() => {
    setHighlight(0);
  }, [options, value]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function selectBranch(branch: string) {
    onChange(branch);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setOpen(true);
      return;
    }

    if (!open || options.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => (current + 1) % options.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => (current - 1 + options.length) % options.length);
      return;
    }

    if (event.key === "Enter" && options[highlight]) {
      event.preventDefault();
      selectBranch(options[highlight]);
    }
  }

  const showList = open && !disabled && (loading || options.length > 0);
  const typedExact = value.trim();

  return (
    <div ref={rootRef} className={cn("relative min-w-0 flex-1", className)}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={showList}
        role="combobox"
        className="h-8 text-xs"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-44 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {loading && options.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("workspacesPage.newWorkspace.branchesLoading")}
            </li>
          ) : (
            options.map((branch, index) => {
              const isCustom = Boolean(typedExact) && branch === typedExact && !suggestions.includes(branch);
              return (
                <li key={branch} role="option" aria-selected={index === highlight}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full rounded-sm px-2 py-1.5 text-left text-xs",
                      index === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectBranch(branch);
                    }}
                    onMouseEnter={() => setHighlight(index)}
                  >
                    {isCustom ? t("workspacesPage.newWorkspace.useTypedBranch", { branch }) : branch}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
