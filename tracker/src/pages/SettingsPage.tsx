import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConnectedIdentitiesCard } from "@/components/settings/ConnectedIdentitiesCard";
import { LanguageCard } from "@/components/settings/LanguageCard";
import { OrchestrationRulesCard } from "@/components/settings/OrchestrationRulesCard";
import { ProviderCredentialsCard } from "@/components/settings/ProviderCredentialsCard";
import { PushNotificationsCard } from "@/components/settings/PushNotificationsCard";
import { AGENT_ICONS, AGENT_KINDS, agentKindLabel, AgentChip } from "@/components/shared/AgentChip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type AgentAvailability,
  type LocalePreference,
  type OrchestratorSettings,
  fetchAgentAvailability,
  fetchSettings,
  updateAgentSettings,
} from "@/services/settings";
import type { AgentKind } from "@/types/issue";


export function SettingsPage() {
  const { t } = useTranslation();
  const [defaultAgent, setDefaultAgent] = useState<AgentKind | null>(null);
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

  async function selectAgent(kind: AgentKind) {
    if (saving || kind === defaultAgent) return;
    setSaving(true);
    const previous = defaultAgent;
    setDefaultAgent(kind);
    try {
      await updateAgentSettings({ default_agent_kind: kind });
      toast.success(t("settings.codingAgent.saved", { agent: agentKindLabel(kind, t) }));
    } catch {
      setDefaultAgent(previous);
      toast.error(t("settings.codingAgent.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

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
            ) : (
              <div className="flex flex-wrap gap-2">
                {defaultAgent === null && (
                  <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
                )}
                {AGENT_KINDS.map((kind) => {
                  const Icon = AGENT_ICONS[kind];
                  return (
                    <AgentChip
                      key={kind}
                      label={agentKindLabel(kind, t)}
                      icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined}
                      active={defaultAgent === kind}
                      disabled={saving || defaultAgent === null}
                      onClick={() => void selectAgent(kind)}
                    />
                  );
                })}
              </div>
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

        <ConnectedIdentitiesCard />

        <div className="xl:col-span-2">
          <ProviderCredentialsCard />
        </div>
      </div>
    </div>
  );
}
