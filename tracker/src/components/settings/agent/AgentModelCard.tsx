import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { updateAgentModel, type AgentToolModel } from "@/services/settings";
import type { AgentKind } from "@/types/issue";

const CLI_DEFAULT_VALUE = "";

interface AgentModelCardProps {
  agent: AgentKind;
  label: string;
  model: AgentToolModel;
}

export function AgentModelCard({ agent, label, model }: AgentModelCardProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string>(
    model.selected ?? CLI_DEFAULT_VALUE,
  );
  const [saving, setSaving] = useState(false);

  async function handleChange(next: string) {
    if (saving || next === selected) return;
    const previous = selected;
    setSelected(next);
    setSaving(true);
    try {
      await updateAgentModel(agent, next === CLI_DEFAULT_VALUE ? null : next);
      toast.success(t("settings.agentTool.model.saved", { name: label }));
    } catch {
      setSelected(previous);
      toast.error(t("settings.agentTool.model.saveFailed", { name: label }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle>
          {t("settings.agentTool.settings", { name: label })}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {t("settings.agentTool.model.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.agentTool.model.description", { name: label })}
            </p>
          </div>
          <NativeSelect
            className="sm:max-w-xs"
            aria-label={t("settings.agentTool.model.title")}
            value={selected}
            disabled={saving}
            onChange={(event) => void handleChange(event.target.value)}
          >
            <option value={CLI_DEFAULT_VALUE}>
              {t("settings.agentTool.model.cliDefault")}
            </option>
            {model.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
        </div>
      </CardContent>
    </Card>
  );
}
