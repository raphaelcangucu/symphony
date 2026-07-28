import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentToolInstall, AgentToolSource, AgentToolStatus } from "@/services/settings";

interface ToolStatusCardProps {
  label: string;
  status: AgentToolStatus;
  source: AgentToolSource;
  install?: AgentToolInstall;
}

function statusValue(status: AgentToolStatus, t: ReturnType<typeof useTranslation>["t"]): string {
  if (!status.installed) return t("settings.agentTool.status.notFound");
  return status.version ?? status.command;
}

function sourceValue(source: AgentToolSource, t: ReturnType<typeof useTranslation>["t"]): string {
  if (source.preferred === "managed" && source.value === "path") {
    return t("settings.agentTool.source.fallbackPath");
  }
  if (source.value === "managed") {
    return source.detail
      ? t("settings.agentTool.source.managedDetail", { path: source.detail })
      : t("settings.agentTool.source.managed");
  }
  if (source.value === "path") {
    return source.detail
      ? t("settings.agentTool.source.pathDetail", { path: source.detail })
      : t("settings.agentTool.source.path");
  }
  return t("settings.agentTool.source.none");
}

export function ToolStatusCard({ label, status, source, install }: ToolStatusCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.agentTool.cli", { name: label })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-1 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{t("settings.agentTool.status.title")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.agentTool.status.description")}</p>
          </div>
          <div className="flex items-center gap-2">
            {status.installed ? (
              <Badge variant="secondary">{t("settings.agentTool.status.installed")}</Badge>
            ) : (
              <Badge variant="outline">{t("settings.agentTool.status.notInstalled")}</Badge>
            )}
            <span className="text-sm text-muted-foreground">{statusValue(status, t)}</span>
          </div>
        </div>

        {install?.pending_version ? (
          <div className="flex items-center justify-between border-b pb-4">
            <p className="text-sm font-medium">{t("settings.agentTool.install.pendingTitle")}</p>
            <Badge variant="outline">
              {t("settings.agentTool.install.pending", { version: install.pending_version })}
            </Badge>
          </div>
        ) : null}

        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{t("settings.agentTool.source.title")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.agentTool.source.description")}</p>
          </div>
          <span className="max-w-full truncate text-sm text-muted-foreground">{sourceValue(source, t)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
