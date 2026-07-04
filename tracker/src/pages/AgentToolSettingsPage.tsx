import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { AgentModelCard } from "@/components/settings/agent/AgentModelCard";
import { InstallActionButton } from "@/components/settings/agent/InstallActionButton";
import { ToolStatusCard } from "@/components/settings/agent/ToolStatusCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { findAgentDescriptor } from "@/lib/settingsAgents";
import { fetchAgentTools, type AgentTool } from "@/services/settings";

function unsupportedTool(slug: string): AgentTool {
  return {
    id: slug,
    kind: "codex",
    status: { installed: false, version: null, path: null, command: slug },
    source: { value: "none", managed: false, detail: null },
    install: { available: false, command: null },
    model: { options: [], selected: null },
  };
}

export function AgentToolSettingsPage() {
  const { t } = useTranslation();
  const { agent: slug = "" } = useParams();
  const descriptor = useMemo(() => findAgentDescriptor(slug), [slug]);

  const [tool, setTool] = useState<AgentTool | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const kind = descriptor?.kind ?? null;

  useEffect(() => {
    if (!kind) {
      setTool(null);
      setLoading(false);
      setLoadError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    void fetchAgentTools()
      .then((tools) => {
        if (cancelled) return;
        const match = tools.find((entry) => entry.kind === kind) ?? null;
        setTool(match);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [kind]);

  if (!descriptor) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("settings.agentTool.unknown.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.agentTool.unknown.description")}</p>
      </div>
    );
  }

  const label = t(descriptor.labelKey);
  const effectiveTool = descriptor.supported ? tool : unsupportedTool(slug);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <descriptor.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{label}</h1>
          {descriptor.beta ? <Badge variant="muted">{t("settings.agentTool.betaBadge")}</Badge> : null}
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("settings.agentTool.cliTag")}
          </span>
        </div>
        <InstallActionButton
          installed={effectiveTool?.status.installed ?? false}
          command={effectiveTool?.install.command ?? null}
        />
      </div>

      {!descriptor.supported ? (
        <>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                {t("settings.agentTool.unsupported", { name: label })}
              </p>
            </CardContent>
          </Card>
          <ToolStatusCard label={label} status={effectiveTool!.status} source={effectiveTool!.source} />
        </>
      ) : loadError ? (
        <p className="text-xs text-muted-foreground">{t("settings.agentTool.loadFailed")}</p>
      ) : loading || !tool ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <>
          <ToolStatusCard label={label} status={tool.status} source={tool.source} />
          {kind ? <AgentModelCard agent={kind} label={label} model={tool.model} /> : null}
        </>
      )}
    </div>
  );
}
