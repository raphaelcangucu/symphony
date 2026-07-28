import { Wrench } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import {
  runAgentLifecycle,
  updateAgentAutoUpdate,
  updateAgentFailover,
  updateAgentSource,
  type AgentCliPreference,
  type AgentPreferredSource,
} from "@/services/settings";
import type { AgentKind } from "@/types/issue";

interface AgentLifecycleCardProps {
  agent: AgentKind;
  initial: AgentCliPreference;
  onLifecycleComplete?: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function AgentLifecycleCard({
  agent,
  initial,
  onLifecycleComplete,
}: AgentLifecycleCardProps) {
  const { t } = useTranslation();
  const [preference, setPreference] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeSource(source: AgentPreferredSource) {
    if (saving || source === preference.preferred_source) return;
    const previous = preference;
    setPreference({ ...preference, preferred_source: source });
    setSaving(true);
    setError(null);
    try {
      setPreference(await updateAgentSource(agent, source));
      onLifecycleComplete?.();
    } catch (reason) {
      setPreference(previous);
      setError(
        errorMessage(reason, t("settings.agentTool.lifecycle.saveFailed")),
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeFailover(enabled: boolean) {
    if (saving) return;
    const previous = preference;
    setPreference({ ...preference, failover_enabled: enabled });
    setSaving(true);
    setError(null);
    try {
      setPreference(await updateAgentFailover(agent, enabled));
    } catch (reason) {
      setPreference(previous);
      setError(
        errorMessage(reason, t("settings.agentTool.lifecycle.saveFailed")),
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeAutoUpdate(enabled: boolean) {
    if (saving) return;
    const previous = preference;
    setPreference({ ...preference, auto_update: enabled });
    setSaving(true);
    setError(null);
    try {
      setPreference(await updateAgentAutoUpdate(agent, enabled));
    } catch (reason) {
      setPreference(previous);
      setError(
        errorMessage(reason, t("settings.agentTool.lifecycle.saveFailed")),
      );
    } finally {
      setSaving(false);
    }
  }

  async function repair() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await runAgentLifecycle(agent, "repair");
      onLifecycleComplete?.();
    } catch (reason) {
      setError(errorMessage(reason, t("settings.agentTool.install.failed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.agentTool.lifecycle.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium">
              {t("settings.agentTool.lifecycle.sourceTitle")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.agentTool.lifecycle.sourceDescription")}
            </p>
          </div>
          <NativeSelect
            className="sm:max-w-xs"
            aria-label={t("settings.agentTool.lifecycle.sourceTitle")}
            value={preference.preferred_source}
            disabled={saving}
            onChange={(event) =>
              void changeSource(event.target.value as AgentPreferredSource)
            }
          >
            <option value="managed">
              {t("settings.agentTool.source.managed")}
            </option>
            <option value="path">{t("settings.agentTool.source.path")}</option>
          </NativeSelect>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              aria-label={t("settings.agentTool.lifecycle.autoUpdateTitle")}
              checked={preference.auto_update}
              disabled={saving}
              onChange={(event) => void changeAutoUpdate(event.target.checked)}
            />
            <span>
              <span className="block font-medium">
                {t("settings.agentTool.lifecycle.autoUpdateTitle")}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t("settings.agentTool.lifecycle.autoUpdateDescription")}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              aria-label={t("settings.agentTool.lifecycle.failoverTitle")}
              checked={preference.failover_enabled}
              disabled={saving}
              onChange={(event) => void changeFailover(event.target.checked)}
            />
            <span>
              <span className="block font-medium">
                {t("settings.agentTool.lifecycle.failoverTitle")}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t("settings.agentTool.lifecycle.failoverDescription")}
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => void repair()}
          >
            <Wrench className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.agentTool.lifecycle.repair")}
          </Button>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
