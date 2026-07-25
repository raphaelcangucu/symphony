import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ExecutionSettingsPicker } from "@/components/assistant/ExecutionSettingsPicker";
import { agentKindLabel } from "@/components/shared/AgentChip";
import type { AssistantCatalogBundle } from "@/lib/assistantSettings";
import { fetchAssistantCatalogBundle } from "@/services/assistant";
import type { AgentKind } from "@/types/issue";

export function ProjectAgentSelect({
  projectSlug,
  value,
  model,
  effort,
  effectiveDefault,
  onChange,
  disabled,
}: {
  projectSlug?: string;
  value: AgentKind | null;
  model: string | null;
  effort: string | null;
  effectiveDefault: AgentKind;
  onChange: (next: { agent: AgentKind | null; model: string | null; effort: string | null }) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [bundle, setBundle] = useState<AssistantCatalogBundle | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBundle(null);
    void fetchAssistantCatalogBundle(projectSlug)
      .then((next) => {
        if (!cancelled) setBundle(next);
      })
      .catch(() => {
        if (!cancelled) setBundle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  return (
    <div className="space-y-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{t("project.wizard.agent.label")}</span>
      {bundle ? (
        <ExecutionSettingsPicker
          bundle={bundle}
          agent={value}
          model={model}
          effort={effort}
          allowInherit
          inheritAgentLabel={t("project.wizard.agent.inherit", {
            agent: agentKindLabel(effectiveDefault, t),
          })}
          disabled={disabled}
          onAgentChange={(agent) => onChange({ agent, model, effort })}
          onModelChange={(nextModel) => onChange({ agent: value, model: nextModel, effort })}
          onEffortChange={(nextEffort) => onChange({ agent: value, model, effort: nextEffort })}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      )}
      <p className="text-xs text-muted-foreground">{t("project.wizard.agent.hint")}</p>
    </div>
  );
}
