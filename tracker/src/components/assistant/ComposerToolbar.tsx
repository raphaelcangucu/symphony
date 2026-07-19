import { Bot, Brain, ChevronDown, Ellipsis, Feather, Flame, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { ModelMenu } from "@/components/assistant/ModelMenu";
import { agentKindLabel } from "@/components/shared/AgentChip";
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
import {
  catalogFor,
  effortLabel,
  effortsForModel,
  modelLabel,
  type AssistantAgentCatalog,
  type AssistantCatalogBundle,
  type AssistantComposerSettings,
  type AssistantEffort,
  type AssistantModelOption,
} from "@/lib/assistantSettings";
import { cn } from "@/lib/utils";
import type { AgentKind } from "@/types/issue";

interface ComposerToolbarProps {
  bundle: AssistantCatalogBundle;
  catalog: AssistantAgentCatalog;
  agent: AgentKind;
  settings: AssistantComposerSettings;
  disabled: boolean;
  composerDisabled: boolean;
  agentMenuDisabled: boolean;
  /** Single chip with nested agent/model/effort sections (narrow viewports). */
  compact?: boolean;
  onAgentChange: (agent: AgentKind) => void;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: AssistantEffort) => void;
}

/** The agent / model / reasoning-effort menu cluster on the composer's toolbar. */
export function ComposerToolbar({
  bundle,
  catalog,
  agent,
  settings,
  disabled,
  composerDisabled,
  agentMenuDisabled,
  compact = false,
  onAgentChange,
  onModelChange,
  onEffortChange,
}: ComposerToolbarProps) {
  const effortOptions = effortsForModel(catalog, settings.model);

  if (compact) {
    return (
      <CompactModelChip
        bundle={bundle}
        catalog={catalog}
        agent={agent}
        settings={settings}
        effortOptions={effortOptions}
        disabled={disabled}
        composerDisabled={composerDisabled}
        agentMenuDisabled={agentMenuDisabled}
        onAgentChange={onAgentChange}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
      />
    );
  }

  return (
    <>
      <AgentMenu
        bundle={bundle}
        agent={agent}
        disabled={disabled || agentMenuDisabled}
        onChange={(next) => {
          if (next != null) onAgentChange(next);
        }}
      />
      <ModelMenu
        catalog={catalog}
        model={settings.model}
        disabled={disabled || composerDisabled}
        onChange={onModelChange}
      />
      {effortOptions.length > 0 ? (
        <EffortMenu
          catalog={catalog}
          model={settings.model}
          effort={settings.effort}
          options={effortOptions}
          disabled={disabled || composerDisabled}
          onChange={(next) => {
            if (next != null) onEffortChange(next);
          }}
        />
      ) : (
        <DerivedThinkingMenu
          catalog={catalog}
          model={settings.model}
          disabled={disabled || composerDisabled}
          onModelChange={onModelChange}
        />
      )}
    </>
  );
}

interface ComposerMoreMenuProps {
  children: ReactNode;
  disabled?: boolean;
}

interface MoreMenuPosition {
  top: number;
  left: number;
  openUpward: boolean;
}

/** Collapses secondary composer tools into a portaled More menu (avoids card overflow clipping). */
export function ComposerMoreMenu({ children, disabled = false }: ComposerMoreMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MoreMenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      // Avoid scheduling an update when already closed — many composer menus
      // mounting at once can hit React's nested-update depth (error #185).
      setPosition((current) => (current === null ? current : null));
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const panelHeight = panel?.offsetHeight ?? 160;
      const panelWidth = panel?.offsetWidth ?? 208;
      const gap = 6;
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      // Prefer below the trigger so the menu does not cover the textarea.
      const openUpward = spaceBelow < panelHeight + gap && spaceAbove > spaceBelow;
      const rawTop = openUpward ? rect.top - gap - panelHeight : rect.bottom + gap;
      const rawLeft = rect.left;
      const top = Math.max(8, Math.min(rawTop, window.innerHeight - panelHeight - 8));
      const left = Math.max(8, Math.min(rawLeft, window.innerWidth - panelWidth - 8));
      setPosition((current) => {
        if (
          current &&
          current.top === top &&
          current.left === left &&
          current.openUpward === openUpward
        ) {
          return current;
        }
        return { top, left, openUpward };
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
    // `children` must not be a dependency: the parent recreates that element
    // every render, which would re-run this effect and loop setPosition.
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      // Nested Radix menus portal outside our panel — keep More open while they are used.
      if (target instanceof Element && target.closest("[data-radix-popper-content-wrapper]")) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (children == null) return null;

  const panel =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="menu"
            aria-label={t("assistant.composer.moreToolsAria")}
            style={
              position
                ? { top: position.top, left: position.left }
                : { top: -9999, left: -9999, visibility: "hidden" }
            }
            className={cn(
              "fixed z-50 min-w-[13rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
              "flex flex-col gap-0.5",
              "[&_button]:h-8 [&_button]:w-full [&_button]:justify-start [&_button]:rounded-sm [&_button]:px-2 [&_button]:font-normal",
              "[&_button_span.hidden]:inline",
              "[&_>span]:mx-0.5 [&_>span]:my-0.5 [&_>span]:w-[calc(100%-0.25rem)] [&_>span]:justify-start",
            )}
            onClick={(event) => {
              const target = event.target;
              if (!(target instanceof Element)) return;
              if (target.closest("[data-radix-popper-content-wrapper]")) return;
              const button = target.closest("button");
              if (!button || button.getAttribute("aria-haspopup") === "menu") return;
              window.setTimeout(() => setOpen(false), 0);
            }}
          >
            {children}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "h-8 w-8 rounded-full text-muted-foreground",
          open && "bg-accent text-foreground",
        )}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="menu"
        aria-label={t("assistant.composer.moreToolsAria")}
        title={t("assistant.composer.moreTools")}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Ellipsis className="h-4 w-4" />
      </Button>
      {panel}
    </>
  );
}

function CompactModelChip({
  bundle,
  catalog,
  agent,
  settings,
  effortOptions,
  disabled,
  composerDisabled,
  agentMenuDisabled,
  onAgentChange,
  onModelChange,
  onEffortChange,
}: {
  bundle: AssistantCatalogBundle;
  catalog: AssistantAgentCatalog;
  agent: AgentKind;
  settings: AssistantComposerSettings;
  effortOptions: ReturnType<typeof effortsForModel>;
  disabled: boolean;
  composerDisabled: boolean;
  agentMenuDisabled: boolean;
  onAgentChange: (agent: AgentKind) => void;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: AssistantEffort) => void;
}) {
  const { t } = useTranslation();
  const agentDisabled = disabled || agentMenuDisabled;
  const settingsDisabled = disabled || composerDisabled;
  const modelName = modelLabel(catalog, settings.model);
  const effortName =
    effortOptions.length > 0 ? effortLabel(catalog, settings.model, settings.effort, t) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 max-w-[11rem] gap-1 px-2 text-xs"
          disabled={disabled}
          aria-label={t("assistant.composer.modelChipAria")}
          title={[agentKindLabel(agent, t), modelName, effortName].filter(Boolean).join(" · ")}
        >
          <Bot className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <span className="truncate">{modelName}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-1">
        <DropdownMenuLabel>{t("assistant.composer.compactModelMenu")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("assistant.composer.agentMenu")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={agent}
          onValueChange={(value) => {
            if (agentDisabled) return;
            onAgentChange(value as AgentKind);
          }}
        >
          {bundle.agents.map((entry) => (
            <DropdownMenuRadioItem key={entry.agent} value={entry.agent} disabled={agentDisabled}>
              {agentKindLabel(entry.agent, t)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("assistant.modelMenu.modelSuffix")}
        </DropdownMenuLabel>
        <ScrollArea className="max-h-48" onWheel={(event) => event.stopPropagation()}>
          <DropdownMenuRadioGroup
            value={settings.model}
            onValueChange={(value) => {
              if (settingsDisabled) return;
              onModelChange(value);
            }}
          >
            {catalog.models.map((entry) => (
              <DropdownMenuRadioItem
                key={entry.id ?? entry.model}
                value={entry.model}
                disabled={settingsDisabled}
                className="gap-2"
              >
                <span className="truncate">{entry.label || entry.model}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </ScrollArea>
        {effortOptions.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("assistant.composer.reasoningEffort")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={settings.effort}
              onValueChange={(value) => {
                if (settingsDisabled) return;
                onEffortChange(value as AssistantEffort);
              }}
            >
              {effortOptions.map((option) => (
                <DropdownMenuRadioItem
                  key={option.id}
                  value={option.id}
                  disabled={settingsDisabled}
                  className="gap-2"
                >
                  {effortIconElement(option.id, `compact-effort-icon-${option.id}`)}
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const AGENT_INHERIT_VALUE = "__inherit__";

export function AgentMenu({
  bundle,
  agent,
  disabled,
  allowInherit = false,
  inheritLabel,
  onChange,
}: {
  bundle: AssistantCatalogBundle;
  agent: AgentKind | null;
  disabled?: boolean;
  allowInherit?: boolean;
  inheritLabel?: string;
  onChange: (agent: AgentKind | null) => void;
}) {
  const { t } = useTranslation();
  const fallbackAgent = agent ?? bundle.defaultAgent;
  const current = catalogFor(bundle, fallbackAgent);
  const resolvedInheritLabel =
    inheritLabel ?? t("issue.create.inherit", { agent: agentKindLabel(current.agent, t) });
  const triggerLabel = agent == null && allowInherit ? resolvedInheritLabel : agentKindLabel(current.agent, t);
  const radioValue = agent == null && allowInherit ? AGENT_INHERIT_VALUE : (agent ?? fallbackAgent);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          <Bot className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          {triggerLabel}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("assistant.composer.agentMenu")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={radioValue}
          onValueChange={(value) => {
            if (value === AGENT_INHERIT_VALUE) {
              onChange(null);
              return;
            }
            onChange(value as AgentKind);
          }}
        >
          {allowInherit ? (
            <DropdownMenuRadioItem value={AGENT_INHERIT_VALUE}>{resolvedInheritLabel}</DropdownMenuRadioItem>
          ) : null}
          {bundle.agents.map((catalog) => (
            <DropdownMenuRadioItem key={catalog.agent} value={catalog.agent}>
              {agentKindLabel(catalog.agent, t)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Renders a "thinking intensity" icon (Jean-style) for a reasoning-effort id.
 * Returns an element (not a component type) so it can be used inline during
 * render without tripping react-hooks/static-components.
 */
function effortIconElement(effortId: string, testId: string): ReactNode {
  const id = effortId.toLowerCase();
  const className = "h-3.5 w-3.5 shrink-0";
  if (id === "low" || id === "minimal") return <Feather className={`${className} text-sky-500`} data-testid={testId} />;
  if (id === "high") return <Flame className={`${className} text-orange-500`} data-testid={testId} />;
  if (id === "xhigh" || id === "max" || id === "ultra" || id === "ultracode") {
    return <Sparkles className={`${className} text-fuchsia-500`} data-testid={testId} />;
  }
  return <Brain className={`${className} text-violet-500`} data-testid={testId} />;
}

const DERIVED_VARIANT_TOKENS = new Set([
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

const DERIVED_EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

interface DerivedThinkingOption {
  key: string;
  model: string;
  effort: string;
  thinking: boolean;
  label: string;
}

export function DerivedThinkingMenu({
  catalog,
  model,
  disabled,
  onModelChange,
}: {
  catalog: AssistantAgentCatalog;
  model: string;
  disabled?: boolean;
  onModelChange: (model: string) => void;
}) {
  const { t } = useTranslation();
  const options = derivedThinkingOptions(catalog, model, t);
  const current = options.find((option) => option.model === model);

  if (!current || options.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          {effortIconElement(current.effort || "medium", "derived-effort-trigger-icon")}
          {current.label}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("assistant.composer.reasoningEffort")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={current.key} onValueChange={(key) => {
          const option = options.find((entry) => entry.key === key);
          if (option) onModelChange(option.model);
        }}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.key} value={option.key} className="gap-2">
              {effortIconElement(option.effort || "medium", `derived-effort-icon-${option.key}`)}
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function derivedThinkingOptions(
  catalog: AssistantAgentCatalog,
  modelId: string,
  t: ReturnType<typeof useTranslation>["t"],
): DerivedThinkingOption[] {
  const currentModel = findCatalogModel(catalog, modelId);
  const current = currentModel ? derivedModelVariant(currentModel) : null;
  const target = current ?? firstDerivedModelVariant(catalog);
  if (!target) return [];

  const seen = new Set<string>();
  const modelOptions = catalog.models
    .map((entry) => ({ entry, variant: derivedModelVariant(entry) }))
    .filter(({ variant }) => variant && variant.baseKey === target.baseKey && variant.fast === target.fast)
    .flatMap(({ entry, variant }) => {
      if (!variant) return [];
      const key = `${variant.thinking ? "thinking" : "standard"}:${variant.effort}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        key,
        model: entry.model,
        effort: variant.effort,
        thinking: variant.thinking,
        label: derivedThinkingLabel(catalog, entry.model, variant.effort, variant.thinking, t),
      }];
    })
    .sort((a, b) => derivedOptionSort(a) - derivedOptionSort(b));

  if (currentModel?.model === "auto") {
    return [
      {
        key: "auto",
        model: "auto",
        effort: "",
        thinking: false,
        label: t("assistant.composer.autoThinking"),
      },
      ...modelOptions,
    ];
  }

  return modelOptions;
}

function derivedThinkingLabel(
  catalog: AssistantAgentCatalog,
  modelId: string,
  effort: string,
  thinking: boolean,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const base = effort ? effortLabel(catalog, modelId, effort, t) : t("assistant.composer.autoThinking");
  return thinking ? t("assistant.composer.thinkingEffort", { effort: base }) : base;
}

function derivedOptionSort(option: DerivedThinkingOption): number {
  const effortIndex = DERIVED_EFFORT_ORDER.indexOf(option.effort as (typeof DERIVED_EFFORT_ORDER)[number]);
  const normalizedEffortIndex = effortIndex === -1 ? DERIVED_EFFORT_ORDER.length : effortIndex;
  return (option.thinking ? 100 : 0) + normalizedEffortIndex;
}

function derivedModelVariant(model: AssistantModelOption):
  | { baseKey: string; effort: string; thinking: boolean; fast: boolean }
  | null {
  const tokens = model.model.toLowerCase().split("-").filter(Boolean);
  if (tokens.length === 0 || model.model === "auto") return null;

  const fast = tokens.includes("fast");
  const thinking = tokens.includes("thinking") || /\bthinking\b/i.test(model.label);
  const effort = explicitEffort(tokens, model.label);
  const baseTokens = tokens.filter((token) => !DERIVED_VARIANT_TOKENS.has(token));

  return {
    baseKey: baseTokens.join("-"),
    effort: effort || "medium",
    thinking,
    fast,
  };
}

function firstDerivedModelVariant(catalog: AssistantAgentCatalog):
  | { baseKey: string; effort: string; thinking: boolean; fast: boolean }
  | null {
  for (const model of catalog.models) {
    const variant = derivedModelVariant(model);
    if (variant) return variant;
  }
  return null;
}

function explicitEffort(tokens: string[], label: string): string | null {
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

function findCatalogModel(catalog: AssistantAgentCatalog, modelId: string): AssistantModelOption | undefined {
  return catalog.models.find((entry) => entry.model === modelId || entry.id === modelId);
}

const EFFORT_INHERIT_VALUE = "__inherit__";

export function EffortMenu({
  catalog,
  model,
  effort,
  options,
  disabled,
  allowInherit = false,
  inheritLabel = "Default",
  onChange,
}: {
  catalog: AssistantAgentCatalog;
  model: string;
  effort: AssistantEffort | null;
  options: ReturnType<typeof effortsForModel>;
  disabled?: boolean;
  allowInherit?: boolean;
  inheritLabel?: string;
  onChange: (effort: AssistantEffort | null) => void;
}) {
  const { t } = useTranslation();
  const fallbackEffort = effort ?? (options[0]?.id as AssistantEffort | undefined) ?? "medium";
  const triggerEffort = effort ?? fallbackEffort;
  const triggerLabel =
    effort == null && allowInherit ? inheritLabel : effortLabel(catalog, model, triggerEffort, t);
  const radioValue = effort == null && allowInherit ? EFFORT_INHERIT_VALUE : triggerEffort;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          {effortIconElement(triggerEffort, "effort-trigger-icon")}
          {triggerLabel}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("assistant.composer.reasoningEffort")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={radioValue}
          onValueChange={(value) => {
            if (value === EFFORT_INHERIT_VALUE) {
              onChange(null);
              return;
            }
            onChange(value as AssistantEffort);
          }}
        >
          {allowInherit ? (
            <DropdownMenuRadioItem value={EFFORT_INHERIT_VALUE}>{inheritLabel}</DropdownMenuRadioItem>
          ) : null}
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} className="gap-2">
              {effortIconElement(option.id, `effort-icon-${option.id}`)}
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
