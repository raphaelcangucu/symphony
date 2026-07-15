import { Bot, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ExecutionSettingsFields } from "@/components/assistant/ExecutionSettingsFields";
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
  defaultComposerSettings,
  effortLabel,
  effortsForModel,
  modelLabel,
  type AssistantCatalogBundle,
} from "@/lib/assistantSettings";
import type { AgentKind } from "@/types/issue";

const AGENT_INHERIT_VALUE = "__inherit__";
const MODEL_INHERIT_VALUE = "__inherit__";
const DEFAULT_INHERIT_LABEL = "Default";

export interface ExecutionSettingsPickerProps {
  bundle: AssistantCatalogBundle;
  agent: AgentKind | null;
  model: string | null;
  effort: string | null;
  allowInherit?: boolean;
  inheritAgentLabel?: string;
  disabled?: boolean;
  compact?: boolean;
  onAgentChange: (agent: AgentKind | null) => void;
  onModelChange: (model: string | null) => void;
  onEffortChange: (effort: string | null) => void;
}

/**
 * Controlled agent/model/effort picker shared by Create, Summary, Settings, and Composer.
 * Parent owns persistence. On concrete agent selection the picker also suggests catalog
 * default model/effort (same UX as AssistantComposer) via onModelChange/onEffortChange.
 */
export function ExecutionSettingsPicker({
  bundle,
  agent,
  model,
  effort,
  allowInherit = false,
  inheritAgentLabel,
  disabled = false,
  compact = false,
  onAgentChange,
  onModelChange,
  onEffortChange,
}: ExecutionSettingsPickerProps) {
  const { t } = useTranslation();
  const resolvedAgent = agent ?? bundle.defaultAgent;
  const resolvedInheritAgentLabel =
    inheritAgentLabel ?? t("issue.create.inherit", { agent: agentKindLabel(resolvedAgent, t) });

  if (compact) {
    return (
      <CompactExecutionSettingsChip
        bundle={bundle}
        agent={agent}
        model={model}
        effort={effort}
        allowInherit={allowInherit}
        inheritAgentLabel={resolvedInheritAgentLabel}
        disabled={disabled}
        onAgentChange={(next) => {
          onAgentChange(next);
          if (next == null) return;
          const nextDefaults = defaultComposerSettings(catalogFor(bundle, next));
          onModelChange(nextDefaults.model);
          onEffortChange(nextDefaults.effort);
        }}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
      />
    );
  }

  return (
    <ExecutionSettingsFields
      bundle={bundle}
      agent={agent}
      model={model}
      effort={effort}
      allowInherit={allowInherit}
      inheritAgentLabel={resolvedInheritAgentLabel}
      disabled={disabled}
      onAgentChange={onAgentChange}
      onModelChange={onModelChange}
      onEffortChange={onEffortChange}
    />
  );
}

function CompactExecutionSettingsChip({
  bundle,
  agent,
  model,
  effort,
  allowInherit,
  inheritAgentLabel,
  disabled,
  onAgentChange,
  onModelChange,
  onEffortChange,
}: {
  bundle: AssistantCatalogBundle;
  agent: AgentKind | null;
  model: string | null;
  effort: string | null;
  allowInherit: boolean;
  inheritAgentLabel: string;
  disabled: boolean;
  onAgentChange: (agent: AgentKind | null) => void;
  onModelChange: (model: string | null) => void;
  onEffortChange: (effort: string | null) => void;
}) {
  const { t } = useTranslation();
  const resolvedAgent = agent ?? bundle.defaultAgent;
  const catalog = catalogFor(bundle, resolvedAgent);
  const defaults = defaultComposerSettings(catalog);
  const effectiveModel = model ?? defaults.model;
  const effortOptions = effortsForModel(catalog, effectiveModel);
  const effectiveEffort = effort ?? defaults.effort;
  const agentName = agent == null && allowInherit ? inheritAgentLabel : agentKindLabel(resolvedAgent, t);
  const modelName = model == null && allowInherit ? DEFAULT_INHERIT_LABEL : modelLabel(catalog, effectiveModel);
  const effortName =
    effortOptions.length === 0
      ? null
      : effort == null && allowInherit
        ? DEFAULT_INHERIT_LABEL
        : effortLabel(catalog, effectiveModel, effectiveEffort, t);

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
          title={[agentName, modelName, effortName].filter(Boolean).join(" · ")}
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
          value={agent == null && allowInherit ? AGENT_INHERIT_VALUE : resolvedAgent}
          onValueChange={(value) => {
            if (disabled) return;
            if (value === AGENT_INHERIT_VALUE) {
              onAgentChange(null);
              return;
            }
            onAgentChange(value as AgentKind);
          }}
        >
          {allowInherit ? (
            <DropdownMenuRadioItem value={AGENT_INHERIT_VALUE} disabled={disabled}>
              {inheritAgentLabel}
            </DropdownMenuRadioItem>
          ) : null}
          {bundle.agents.map((entry) => (
            <DropdownMenuRadioItem key={entry.agent} value={entry.agent} disabled={disabled}>
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
            value={model == null && allowInherit ? MODEL_INHERIT_VALUE : effectiveModel}
            onValueChange={(value) => {
              if (disabled) return;
              if (value === MODEL_INHERIT_VALUE) {
                onModelChange(null);
                return;
              }
              onModelChange(value);
            }}
          >
            {allowInherit ? (
              <DropdownMenuRadioItem value={MODEL_INHERIT_VALUE} disabled={disabled}>
                {DEFAULT_INHERIT_LABEL}
              </DropdownMenuRadioItem>
            ) : null}
            {catalog.models.map((entry) => (
              <DropdownMenuRadioItem
                key={entry.id ?? entry.model}
                value={entry.model}
                disabled={disabled}
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
              value={effort == null && allowInherit ? AGENT_INHERIT_VALUE : effectiveEffort}
              onValueChange={(value) => {
                if (disabled) return;
                if (value === AGENT_INHERIT_VALUE) {
                  onEffortChange(null);
                  return;
                }
                onEffortChange(value);
              }}
            >
              {allowInherit ? (
                <DropdownMenuRadioItem value={AGENT_INHERIT_VALUE} disabled={disabled}>
                  {DEFAULT_INHERIT_LABEL}
                </DropdownMenuRadioItem>
              ) : null}
              {effortOptions.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id} disabled={disabled} className="gap-2">
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
