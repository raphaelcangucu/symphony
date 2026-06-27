import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AGENT_ICONS, AGENT_KINDS, agentKindLabel } from "@/components/shared/AgentChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAgentUsage } from "@/hooks/useAgentUsage";
import { cn } from "@/lib/utils";
import type { AgentUsageSnapshot, UsageWindow } from "@/types/agent-usage";
import type { AgentKind } from "@/types/issue";

import { UsageWindowBar } from "./UsageWindowBar";

type TranslateFn = ReturnType<typeof useTranslation>["t"];

function formatEpoch(seconds: number | null): string | null {
  if (seconds == null) return null;

  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function windowLabel(usageWindow: UsageWindow, t: TranslateFn): string {
  const { kind } = usageWindow;
  if (kind === "session" || kind === "weekly" || kind === "sonnet_weekly" || kind === "reviews") {
    return t(`settings.usage.window.${kind}`);
  }
  if (typeof kind === "string" && kind.startsWith("model:")) {
    return t("settings.usage.window.model", { name: kind.slice("model:".length) });
  }
  return String(kind);
}

function creditsLine(snapshot: AgentUsageSnapshot, t: TranslateFn): string | null {
  if (snapshot.creditsUnlimited) return t("settings.usage.creditsUnlimited");
  if (snapshot.creditsRemaining != null) {
    return t("settings.usage.credits", { amount: snapshot.creditsRemaining });
  }
  return null;
}

interface AgentUsageSectionProps {
  kind: AgentKind;
  snapshot: AgentUsageSnapshot | null;
  t: TranslateFn;
}

function AgentUsageSection({ kind, snapshot, t }: AgentUsageSectionProps) {
  const Icon = AGENT_ICONS[kind];
  const updated = snapshot ? formatEpoch(snapshot.fetchedAt) : null;
  const credits = snapshot ? creditsLine(snapshot, t) : null;

  return (
    <div className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="h-4 w-4" /> : null}
        <span className="text-sm font-semibold">{agentKindLabel(kind, t)}</span>
        {snapshot?.stale ? (
          <Badge variant="muted" className="ml-1">
            {t("settings.usage.stale")}
          </Badge>
        ) : null}
      </div>

      {!snapshot ? (
        <p className="text-xs text-muted-foreground">{t("settings.usage.unavailable")}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {snapshot.plan ? <span>{t("settings.usage.plan", { plan: snapshot.plan })}</span> : null}
            {credits ? <span>{credits}</span> : null}
            {updated ? <span>{t("settings.usage.updated", { time: updated })}</span> : null}
          </div>

          {snapshot.windows.length || snapshot.modelLimits.length ? (
            <div className="space-y-3">
              {[...snapshot.windows, ...snapshot.modelLimits].map((usageWindow, index) => (
                <UsageWindowBar
                  key={`${usageWindow.kind}-${index}`}
                  label={windowLabel(usageWindow, t)}
                  usageWindow={usageWindow}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("settings.usage.unavailable")}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentUsagePanel() {
  const { t } = useTranslation();
  const { usage, isFetching, error, refetch } = useAgentUsage();

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>{t("settings.usage.title")}</CardTitle>
          <CardDescription>{t("settings.usage.description")}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isFetching ? "secondary" : "muted"}>
            {isFetching ? t("settings.usage.refreshing") : t("settings.usage.upToDate")}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            {t("settings.usage.refresh")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-xs text-muted-foreground">{t("settings.usage.loadFailed")}</p>
        ) : (
          AGENT_KINDS.map((kind) => (
            <AgentUsageSection key={kind} kind={kind} snapshot={usage?.[kind] ?? null} t={t} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
