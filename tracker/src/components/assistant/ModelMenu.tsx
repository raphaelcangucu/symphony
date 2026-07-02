import { ChevronDown, Search, Sparkles, Star } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import { agentKindLabel } from "@/components/shared/AgentChip";
import { modelLabel, type AssistantAgentCatalog, type AssistantModelOption } from "@/lib/assistantSettings";
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
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const modelOptions = useMemo(() => groupedModelOptions(catalog, model), [catalog, model]);
  const selectedKey = selectedModelKey(catalog, model);
  const selectedLabel = modelOptions.find((option) => option.key === selectedKey)?.label ?? modelLabel(catalog, model);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return modelOptions;
    return modelOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) || option.model.toLowerCase().includes(needle),
    );
  }, [modelOptions, query]);

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
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-500" />
          {selectedLabel}
          {showChevron && <ChevronDown className="h-3 w-3 opacity-60" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={12}
        className="flex w-64 max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] flex-col overflow-hidden p-1"
      >
        <DropdownMenuLabel className="shrink-0">
          {agentKindLabel(catalog.agent, t)} · {t("assistant.modelMenu.modelSuffix")}
        </DropdownMenuLabel>
        <div className="shrink-0 px-1 pb-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("assistant.modelMenu.searchPlaceholder")}
              className="h-8 w-full rounded-sm border border-input bg-background pl-7 pr-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              // Stop Radix's menu typeahead/navigation from hijacking typing.
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
        </div>
        <DropdownMenuSeparator className="shrink-0" />
        {filtered.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">{t("assistant.modelMenu.noMatch")}</div>
        ) : (
          <ScrollArea
            data-testid="model-menu-scroll"
            className="min-h-0 max-h-60 flex-1"
            onWheel={(event) => event.stopPropagation()}
          >
            <DropdownMenuRadioGroup
              value={selectedKey}
              onValueChange={(key) => {
                const option = modelOptions.find((entry) => entry.key === key);
                if (option) onChange(option.model);
              }}
            >
              {filtered.map((option) => (
                <DropdownMenuRadioItem key={option.key} value={option.key} className="gap-2">
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.isDefault ? (
                    <Star
                      className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500"
                      data-testid="model-default-star"
                      aria-hidden="true"
                    />
                  ) : null}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ModelMenuOption {
  key: string;
  model: string;
  label: string;
  isDefault: boolean;
}

interface CursorVariant {
  baseKey: string;
  baseLabel: string;
  effort: string;
  thinking: boolean;
  fast: boolean;
}

const CURSOR_VARIANT_TOKENS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "thinking",
  "fast",
]);

function groupedModelOptions(catalog: AssistantAgentCatalog, selectedModel: string): ModelMenuOption[] {
  if (catalog.agent !== "cursor") {
    return catalog.models.map((option) => ({
      key: option.model,
      model: option.model,
      label: option.label,
      isDefault: option.isDefault,
    }));
  }

  const variants = catalog.models.map((option) => ({ option, variant: cursorVariant(option) }));
  if (!variants.some(({ variant }) => variant !== null)) {
    return catalog.models.map((option) => ({
      key: option.model,
      model: option.model,
      label: option.label,
      isDefault: option.isDefault,
    }));
  }

  const selected = variants.find(({ option }) => option.model === selectedModel || option.id === selectedModel);
  const selectedVariant = selected?.variant ?? null;
  const seen = new Set<string>();

  return variants.flatMap(({ option, variant }) => {
    if (!variant) {
      return [{
        key: option.model,
        model: option.model,
        label: option.label,
        isDefault: option.isDefault,
      }];
    }

    const key = `cursor:${variant.baseKey}`;
    if (seen.has(key)) return [];
    seen.add(key);

    const preferred = preferredCursorModelForBase(variants, variant.baseKey, selectedVariant) ?? option;
    return [{
      key,
      model: preferred.model,
      label: variant.baseLabel,
      isDefault: variants.some((entry) => entry.variant?.baseKey === variant.baseKey && entry.option.isDefault),
    }];
  });
}

function selectedModelKey(catalog: AssistantAgentCatalog, model: string): string {
  if (catalog.agent !== "cursor") return model;
  const option = catalog.models.find((entry) => entry.model === model || entry.id === model);
  const variant = option ? cursorVariant(option) : null;
  return variant ? `cursor:${variant.baseKey}` : model;
}

function preferredCursorModelForBase(
  variants: Array<{ option: AssistantModelOption; variant: CursorVariant | null }>,
  baseKey: string,
  selectedVariant: CursorVariant | null,
): AssistantModelOption | null {
  const candidates = variants.filter((entry) => entry.variant?.baseKey === baseKey);
  if (candidates.length === 0) return null;

  if (selectedVariant) {
    const exact = candidates.find(
      ({ variant }) =>
        variant?.effort === selectedVariant.effort &&
        variant.thinking === selectedVariant.thinking &&
        variant.fast === selectedVariant.fast,
    );
    if (exact) return exact.option;

    const sameEffort = candidates.find(({ variant }) => variant?.effort === selectedVariant.effort);
    if (sameEffort) return sameEffort.option;
  }

  return (
    candidates.find(({ variant }) => variant?.effort === "medium" && !variant.thinking && !variant.fast)?.option ??
    candidates.find(({ option }) => option.isDefault)?.option ??
    candidates[0].option
  );
}

function cursorVariant(model: AssistantModelOption): CursorVariant | null {
  if (model.model === "auto") return null;
  const tokens = model.model.toLowerCase().split("-").filter(Boolean);
  const effort = explicitCursorEffort(tokens, model.label);
  const fast = tokens.includes("fast");
  const thinking = tokens.includes("thinking") || /\bthinking\b/i.test(model.label);
  const baseTokens = tokens.filter((token) => !CURSOR_VARIANT_TOKENS.has(token));

  if (baseTokens.length === tokens.length && !effort && !fast && !thinking) return null;

  return {
    baseKey: baseTokens.join("-"),
    baseLabel: baseCursorLabel(model.label),
    effort: effort || "medium",
    fast,
    thinking,
  };
}

function explicitCursorEffort(tokens: string[], label: string): string | null {
  for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    if (tokens.includes(effort)) return effort;
  }
  const lower = label.toLowerCase();
  if (/\bextra high\b/.test(lower)) return "xhigh";
  if (/\bmax\b/.test(lower)) return "max";
  if (/\bhigh\b/.test(lower)) return "high";
  if (/\bmedium\b/.test(lower)) return "medium";
  if (/\blow\b/.test(lower)) return "low";
  if (/\bnone\b/.test(lower)) return "none";
  return null;
}

function baseCursorLabel(label: string): string {
  return label
    .replace(/\s*\(default\)\s*/gi, "")
    .replace(/\bExtra High\b/gi, "")
    .replace(/\bThinking\b/gi, "")
    .replace(/\bMinimal\b/gi, "")
    .replace(/\bMedium\b/gi, "")
    .replace(/\bHigh\b/gi, "")
    .replace(/\bLow\b/gi, "")
    .replace(/\bNone\b/gi, "")
    .replace(/\bMax\b/gi, "")
    .replace(/\bFast\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
