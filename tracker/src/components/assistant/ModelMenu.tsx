import { ChevronDown, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { modelLabel, type AssistantAgentCatalog } from "@/lib/assistantSettings";
import { cn } from "@/lib/utils";

interface ModelMenuProps {
  catalog: AssistantAgentCatalog;
  model: string;
  disabled?: boolean;
  onChange: (model: string) => void;
  /** Trigger button styling — assistant composer uses ghost, execution composer uses outline. */
  triggerVariant?: "ghost" | "outline";
  showChevron?: boolean;
}

export function ModelMenu({
  catalog,
  model,
  disabled,
  onChange,
  triggerVariant = "ghost",
  showChevron = true,
}: ModelMenuProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return catalog.models;
    return catalog.models.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) || option.model.toLowerCase().includes(needle),
    );
  }, [catalog.models, query]);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          // Radix focuses the first menu item on open; pull focus to the
          // search field on the next frame so typing filters immediately.
          requestAnimationFrame(() => searchRef.current?.focus());
        } else {
          setQuery("");
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={triggerVariant}
          size="sm"
          className={cn("h-8 gap-1 px-2 text-xs")}
          disabled={disabled}
        >
          {modelLabel(catalog, model)}
          {showChevron && <ChevronDown className="h-3 w-3 opacity-60" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{catalog.agentLabel} · Model</DropdownMenuLabel>
        <div className="px-1 pb-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models…"
              className="h-8 w-full rounded-sm border border-input bg-background pl-7 pr-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              // Stop Radix's menu typeahead/navigation from hijacking typing.
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
        </div>
        <DropdownMenuSeparator />
        {filtered.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">No models match.</div>
        ) : (
          <DropdownMenuRadioGroup
            value={model}
            onValueChange={onChange}
            className="max-h-[280px] overflow-y-auto"
          >
            {filtered.map((option) => (
              <DropdownMenuRadioItem key={option.id} value={option.model}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
