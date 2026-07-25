import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  AgentSettingsField,
  EffortSettingsField,
  ModelSettingsField,
} from "@/components/assistant/ExecutionSettingsFields";
import { agentKindLabel } from "@/components/shared/AgentChip";
import {
  catalogFor,
  defaultComposerSettings,
  effortsForModel,
  type AssistantCatalogBundle,
} from "@/lib/assistantSettings";
import { fetchAssistantCatalogBundle } from "@/services/assistant";
import type { AgentKind } from "@/types/issue";

export interface ExecutionSettingsValue {
  agent: AgentKind | null;
  model: string | null;
  effort: string | null;
}

interface InlineExecutionSettingsFieldsProps {
  projectSlug: string;
  value: ExecutionSettingsValue;
  effectiveAgent: AgentKind;
  disabled?: boolean;
  saving?: boolean;
  onSave: (value: ExecutionSettingsValue) => Promise<boolean>;
  /** Renders a labeled field shell around each control. */
  renderField: (label: string, control: ReactNode) => ReactNode;
}

export function InlineExecutionSettingsFields({
  projectSlug,
  value,
  effectiveAgent,
  disabled = false,
  saving = false,
  onSave,
  renderField,
}: InlineExecutionSettingsFieldsProps) {
  const { t } = useTranslation();
  const [bundle, setBundle] = useState<AssistantCatalogBundle | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);

  const inheritLabel = t("issue.create.inherit", { agent: agentKindLabel(effectiveAgent, t) });
  const resolvedAgent = value.agent ?? bundle?.defaultAgent ?? effectiveAgent;
  const catalog = useMemo(
    () => (bundle ? catalogFor(bundle, resolvedAgent) : null),
    [bundle, resolvedAgent],
  );
  const defaults = useMemo(
    () => (catalog ? defaultComposerSettings(catalog) : null),
    [catalog],
  );
  const effectiveModel = value.model ?? defaults?.model ?? "";
  const effortOptions = useMemo(
    () => (catalog ? effortsForModel(catalog, effectiveModel) : []),
    [catalog, effectiveModel],
  );

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    void fetchAssistantCatalogBundle(projectSlug)
      .then((next) => {
        if (!cancelled) setBundle(next);
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  async function commit(next: ExecutionSettingsValue) {
    const unchanged =
      next.agent === value.agent && next.model === value.model && next.effort === value.effort;
    if (unchanged) return;
    await onSave(next);
  }

  function handleAgentChange(agent: AgentKind | null) {
    if (agent == null) {
      void commit({ agent: null, model: value.model, effort: value.effort });
      return;
    }
    if (!bundle) return;
    const nextDefaults = defaultComposerSettings(catalogFor(bundle, agent));
    void commit({ agent, model: nextDefaults.model, effort: nextDefaults.effort });
  }

  const controlsDisabled = disabled || saving || catalogLoading || !bundle;

  if (!bundle || !catalog) {
    return (
      <>
        {renderField(
          t("issue.summary.agent"),
          <span className="text-xs text-muted-foreground">{t("common.loading")}</span>,
        )}
        {renderField(
          t("issue.summary.model"),
          <span className="text-xs text-muted-foreground">{t("common.loading")}</span>,
        )}
        {renderField(
          t("issue.summary.effort"),
          <span className="text-xs text-muted-foreground">{t("common.loading")}</span>,
        )}
      </>
    );
  }

  return (
    <>
      {renderField(
        t("issue.summary.agent"),
        <AgentSettingsField
          bundle={bundle}
          agent={value.agent}
          disabled={controlsDisabled}
          allowInherit
          inheritLabel={inheritLabel}
          onChange={handleAgentChange}
        />,
      )}
      {renderField(
        t("issue.summary.model"),
        <ModelSettingsField
          catalog={catalog}
          model={value.model}
          effectiveModel={effectiveModel}
          allowInherit
          disabled={controlsDisabled}
          onChange={(model) => void commit({ ...value, model })}
        />,
      )}
      {renderField(
        t("issue.summary.effort"),
        <EffortSettingsField
          catalog={catalog}
          agent={value.agent}
          allowInherit
          model={effectiveModel}
          effort={value.effort}
          options={effortOptions}
          disabled={controlsDisabled}
          onEffortChange={(effort) => void commit({ ...value, effort })}
          onModelChange={(model) => void commit({ ...value, model })}
        />,
      )}
    </>
  );
}
