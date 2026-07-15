import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AgentMenu, DerivedThinkingMenu, EffortMenu } from "@/components/assistant/ComposerToolbar";
import { ModelMenu } from "@/components/assistant/ModelMenu";
import { ExecutionModeMenu } from "@/components/issues/issue-detail/ExecutionModeMenu";
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
  effortsForModel,
  modelLabel,
  type AssistantCatalogBundle,
} from "@/lib/assistantSettings";
import type { AgentKind, ExecutionMode } from "@/types/issue";

const MODEL_INHERIT_VALUE = "__inherit__";
const DEFAULT_INHERIT_LABEL = "Default";

export interface ExecutionSettingsFieldsProps {
  bundle: AssistantCatalogBundle;
  agent: AgentKind | null;
  model: string | null;
  effort: string | null;
  allowInherit?: boolean;
  inheritAgentLabel?: string;
  disabled?: boolean;
  onAgentChange: (agent: AgentKind | null) => void;
  onModelChange: (model: string | null) => void;
  onEffortChange: (effort: string | null) => void;
}

/**
 * Shared agent / model / effort menus used by Summary fields, Create, Settings,
 * and session/workspace create dialogs. Parent owns persistence.
 */
export function ExecutionSettingsFields({
  bundle,
  agent,
  model,
  effort,
  allowInherit = false,
  inheritAgentLabel,
  disabled = false,
  onAgentChange,
  onModelChange,
  onEffortChange,
}: ExecutionSettingsFieldsProps) {
  const { t } = useTranslation();
  const resolvedAgent = agent ?? bundle.defaultAgent;
  const catalog = catalogFor(bundle, resolvedAgent);
  const defaults = defaultComposerSettings(catalog);
  const effectiveModel = model ?? defaults.model;
  const effortOptions = effortsForModel(catalog, effectiveModel);
  const resolvedInheritAgentLabel =
    inheritAgentLabel ?? t("issue.create.inherit", { agent: agentKindLabel(resolvedAgent, t) });

  function handleAgentChange(next: AgentKind | null) {
    onAgentChange(next);
    if (next == null) return;
    const nextDefaults = defaultComposerSettings(catalogFor(bundle, next));
    onModelChange(nextDefaults.model);
    onEffortChange(nextDefaults.effort);
  }

  return (
    <>
      <AgentSettingsField
        bundle={bundle}
        agent={agent}
        disabled={disabled}
        allowInherit={allowInherit}
        inheritLabel={resolvedInheritAgentLabel}
        onChange={handleAgentChange}
      />
      <ModelSettingsField
        catalog={catalog}
        model={model}
        effectiveModel={effectiveModel}
        allowInherit={allowInherit}
        disabled={disabled}
        onChange={onModelChange}
      />
      <EffortSettingsField
        catalog={catalog}
        agent={agent}
        allowInherit={allowInherit}
        model={effectiveModel}
        effort={effort}
        options={effortOptions}
        disabled={disabled}
        onEffortChange={onEffortChange}
        onModelChange={(next) => onModelChange(next)}
      />
    </>
  );
}

export function AgentSettingsField({
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
  return (
    <AgentMenu
      bundle={bundle}
      agent={agent}
      disabled={disabled}
      allowInherit={allowInherit}
      inheritLabel={inheritLabel}
      onChange={onChange}
    />
  );
}

export function ModelSettingsField({
  catalog,
  model,
  effectiveModel,
  allowInherit = false,
  disabled,
  onChange,
}: {
  catalog: ReturnType<typeof catalogFor>;
  model: string | null;
  effectiveModel: string;
  allowInherit?: boolean;
  disabled?: boolean;
  onChange: (model: string | null) => void;
}) {
  if (allowInherit) {
    return <InheritableModelMenu catalog={catalog} model={model} disabled={disabled} onChange={onChange} />;
  }

  return (
    <ModelMenu catalog={catalog} model={effectiveModel} disabled={disabled} onChange={(next) => onChange(next)} />
  );
}

export function EffortSettingsField({
  catalog,
  agent,
  allowInherit = false,
  model,
  effort,
  options,
  disabled,
  onEffortChange,
  onModelChange,
}: {
  catalog: ReturnType<typeof catalogFor>;
  agent: AgentKind | null;
  allowInherit?: boolean;
  model: string;
  effort: string | null;
  options: ReturnType<typeof effortsForModel>;
  disabled?: boolean;
  onEffortChange: (effort: string | null) => void;
  onModelChange: (model: string) => void;
}) {
  if (options.length > 0) {
    return (
      <EffortMenu
        catalog={catalog}
        model={model}
        effort={effort}
        options={options}
        disabled={disabled}
        allowInherit={allowInherit}
        inheritLabel={DEFAULT_INHERIT_LABEL}
        onChange={onEffortChange}
      />
    );
  }

  if (agent != null || !allowInherit) {
    return (
      <DerivedThinkingMenu catalog={catalog} model={model} disabled={disabled} onModelChange={onModelChange} />
    );
  }

  return null;
}

export function ExecutionModeField({
  agent,
  mode,
  disabled,
  onChange,
}: {
  agent: AgentKind;
  mode: ExecutionMode;
  disabled?: boolean;
  onChange: (mode: ExecutionMode) => void;
}) {
  return <ExecutionModeMenu agent={agent} mode={mode} disabled={disabled} onChange={onChange} />;
}

function InheritableModelMenu({
  catalog,
  model,
  disabled,
  onChange,
}: {
  catalog: ReturnType<typeof catalogFor>;
  model: string | null;
  disabled?: boolean;
  onChange: (model: string | null) => void;
}) {
  const { t } = useTranslation();
  const defaults = defaultComposerSettings(catalog);
  const effectiveModel = model ?? defaults.model;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          {model == null ? DEFAULT_INHERIT_LABEL : modelLabel(catalog, effectiveModel)}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-1">
        <DropdownMenuLabel>
          {agentKindLabel(catalog.agent, t)} · {t("assistant.modelMenu.modelSuffix")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ScrollArea className="max-h-60" onWheel={(event) => event.stopPropagation()}>
          <DropdownMenuRadioGroup
            value={model == null ? MODEL_INHERIT_VALUE : effectiveModel}
            onValueChange={(value) => {
              if (value === MODEL_INHERIT_VALUE) {
                onChange(null);
                return;
              }
              onChange(value);
            }}
          >
            <DropdownMenuRadioItem value={MODEL_INHERIT_VALUE}>{DEFAULT_INHERIT_LABEL}</DropdownMenuRadioItem>
            {catalog.models.map((entry) => (
              <DropdownMenuRadioItem key={entry.id ?? entry.model} value={entry.model} className="gap-2">
                <span className="truncate">{entry.label || entry.model}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
