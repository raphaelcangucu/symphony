import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ExecutionSettingsPicker } from "@/components/assistant/ExecutionSettingsPicker";
import { LanguageCard } from "@/components/settings/LanguageCard";
import { OrchestrationRulesCard } from "@/components/settings/OrchestrationRulesCard";
import { PushNotificationsCard } from "@/components/settings/PushNotificationsCard";
import { AGENT_KINDS, agentKindLabel } from "@/components/shared/AgentChip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fallbackCatalogBundle, type AssistantCatalogBundle } from "@/lib/assistantSettings";
import {
  type AgentAvailability,
  type AgentEffortSettings,
  type AgentModelSettings,
  type LocalePreference,
  type OrchestratorSettings,
  fetchAgentAvailability,
  fetchSettings,
  updateAgentEffort,
  updateAgentModel,
  updateAgentSettings,
} from "@/services/settings";
import type { AgentKind } from "@/types/issue";

export function SettingsPage() {
  const { t } = useTranslation();
  const [defaultAgent, setDefaultAgent] = useState<AgentKind | null>(null);
  const [agentModels, setAgentModels] = useState<AgentModelSettings>({});
  const [agentEfforts, setAgentEfforts] = useState<AgentEffortSettings>({});
  const [bundle] = useState<AssistantCatalogBundle>(() => fallbackCatalogBundle());
  const [orchestrator, setOrchestrator] = useState<OrchestratorSettings | null>(null);
  const [uiLocale, setUiLocale] = useState<LocalePreference | null>(null);
  const [availability, setAvailability] = useState<AgentAvailability | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [availabilityError, setAvailabilityError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchSettings()
      .then((settings) => {
        if (!cancelled) {
          setDefaultAgent(settings.agents.default_agent_kind);
          setAgentModels(settings.agent_models ?? {});
          setAgentEfforts(settings.agent_efforts ?? {});
          setOrchestrator(settings.orchestrator);
          setUiLocale(settings.ui.locale);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    void fetchAgentAvailability()
      .then((result) => {
        if (!cancelled) setAvailability(result);
      })
      .catch(() => {
        if (!cancelled) setAvailabilityError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function persistDefaults(next: {
    agent: AgentKind;
    model: string | null;
    effort: string | null;
  }) {
    if (saving) return;
    setSaving(true);
    const previousAgent = defaultAgent;
    const previousModels = agentModels;
    const previousEfforts = agentEfforts;
    setDefaultAgent(next.agent);
    setAgentModels((current) => ({ ...current, [next.agent]: next.model }));
    setAgentEfforts((current) => ({ ...current, [next.agent]: next.effort }));
    try {
      await updateAgentSettings({ default_agent_kind: next.agent });
      await updateAgentModel(next.agent, next.model);
      await updateAgentEffort(next.agent, next.effort);
      toast.success(t("settings.codingAgent.saved", { agent: agentKindLabel(next.agent, t) }));
    } catch {
      setDefaultAgent(previousAgent);
      setAgentModels(previousModels);
      setAgentEfforts(previousEfforts);
      toast.error(t("settings.codingAgent.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const activeAgent = defaultAgent ?? bundle.defaultAgent;

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("settings.sections.general.label")}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">{t("settings.subtitle")}</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <LanguageCard initial={uiLocale} loadError={loadError} onLocaleChange={setUiLocale} />

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.codingAgent.title")}</CardTitle>
            <CardDescription>{t("settings.codingAgent.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadError ? (
              <p className="text-xs text-muted-foreground">{t("settings.loadFailed")}</p>
            ) : defaultAgent === null ? (
              <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
            ) : (
              <ExecutionSettingsPicker
                bundle={bundle}
                agent={activeAgent}
                model={agentModels[activeAgent] ?? null}
                effort={agentEfforts[activeAgent] ?? null}
                allowInherit={false}
                disabled={saving}
                onAgentChange={(agent) => {
                  if (!agent) return;
                  void persistDefaults({
                    agent,
                    model: agentModels[agent] ?? null,
                    effort: agentEfforts[agent] ?? null,
                  });
                }}
                onModelChange={(model) => {
                  void persistDefaults({ agent: activeAgent, model, effort: agentEfforts[activeAgent] ?? null });
                }}
                onEffortChange={(effort) => {
                  void persistDefaults({ agent: activeAgent, model: agentModels[activeAgent] ?? null, effort });
                }}
              />
            )}

            {availabilityError ? (
              <p className="text-xs text-muted-foreground">{t("settings.codingAgent.availabilityFailed")}</p>
            ) : availability ? (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {AGENT_KINDS.map((kind) => {
                  const entry = availability[kind];
                  return (
                    <li key={kind}>
                      {entry.available
                        ? `✓ ${entry.version ?? entry.command}`
                        : `✗ ${t("settings.codingAgent.notFound", { command: entry.command })}`}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <OrchestrationRulesCard initial={orchestrator} loadError={loadError} />

        <PushNotificationsCard />
      </div>
    </div>
  );
}
