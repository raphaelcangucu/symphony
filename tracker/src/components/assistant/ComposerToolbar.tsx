import { Bot, Brain, ChevronDown, Feather, Flame, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
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
import {
  catalogFor,
  effortLabel,
  effortsForModel,
  type AssistantAgentCatalog,
  type AssistantCatalogBundle,
  type AssistantComposerSettings,
  type AssistantEffort,
  type AssistantModelOption,
} from "@/lib/assistantSettings";
import type { AgentKind } from "@/types/issue";

interface ComposerToolbarProps {
  bundle: AssistantCatalogBundle;
  catalog: AssistantAgentCatalog;
  agent: AgentKind;
  settings: AssistantComposerSettings;
  disabled: boolean;
  composerDisabled: boolean;
  agentMenuDisabled: boolean;
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
  onAgentChange,
  onModelChange,
  onEffortChange,
}: ComposerToolbarProps) {
  const effortOptions = effortsForModel(catalog, settings.model);

  return (
    <>
      <AgentMenu bundle={bundle} agent={agent} disabled={disabled || agentMenuDisabled} onChange={onAgentChange} />
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
          onChange={onEffortChange}
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

function AgentMenu({
  bundle,
  agent,
  disabled,
  onChange,
}: {
  bundle: AssistantCatalogBundle;
  agent: AgentKind;
  disabled?: boolean;
  onChange: (agent: AgentKind) => void;
}) {
  const { t } = useTranslation();
  const current = catalogFor(bundle, agent);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          <Bot className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          {agentKindLabel(current.agent, t)}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("assistant.composer.agentMenu")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={agent} onValueChange={(v) => onChange(v as AgentKind)}>
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

function DerivedThinkingMenu({
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

function EffortMenu({
  catalog,
  model,
  effort,
  options,
  disabled,
  onChange,
}: {
  catalog: AssistantAgentCatalog;
  model: string;
  effort: AssistantEffort;
  options: ReturnType<typeof effortsForModel>;
  disabled?: boolean;
  onChange: (effort: AssistantEffort) => void;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          {effortIconElement(effort, "effort-trigger-icon")}
          {effortLabel(catalog, model, effort)}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("assistant.composer.reasoningEffort")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={effort} onValueChange={onChange}>
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
