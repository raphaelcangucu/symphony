import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createProjectTelegramPairingCode,
  getProjectTelegramGateway,
  resetProjectTelegramSession,
  unpairProjectTelegram,
  type GatewayPairingCode,
} from "@/services/gateways";
import type { ProjectTelegramGateway } from "@/types/gateways";

interface ProjectTelegramIntegrationCardProps {
  projectSlug: string;
}

export function ProjectTelegramIntegrationCard({ projectSlug }: ProjectTelegramIntegrationCardProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<ProjectTelegramGateway | null>(null);
  const [pairingCode, setPairingCode] = useState<GatewayPairingCode | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getProjectTelegramGateway(projectSlug)
      .then((loaded) => {
        if (!cancelled) setState(loaded);
      })
      .catch(() => {
        if (!cancelled) toast.error(t("project.config.integrations.telegram.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [projectSlug, t]);

  async function generatePairingCode() {
    setPairingCode(await createProjectTelegramPairingCode(projectSlug));
  }

  async function resetSession() {
    setState(await resetProjectTelegramSession(projectSlug));
  }

  async function unpair() {
    setState(await unpairProjectTelegram(projectSlug));
  }

  const binding = state?.binding ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Telegram</CardTitle>
        <CardDescription>{t("project.config.integrations.telegram.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!state ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {state.globalConfigured
                ? t("project.config.integrations.telegram.globalReady")
                : t("project.config.integrations.telegram.globalMissing")}
            </p>

            {binding ? (
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">Topic {binding.threadId}</p>
                <p className="text-muted-foreground">{binding.conversationId}</p>
                <p className="text-muted-foreground">
                  {t("project.config.integrations.telegram.bindingSummary", {
                    agent: binding.defaultAgentKind ?? "default",
                    mode: binding.activeMode,
                  })}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("project.config.integrations.telegram.notPaired")}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void generatePairingCode()}>
                {t("project.config.integrations.telegram.generatePairing")}
              </Button>
              <Button type="button" variant="secondary" disabled={!binding} onClick={() => void resetSession()}>
                {t("project.config.integrations.telegram.resetSession")}
              </Button>
              <Button type="button" variant="destructive" disabled={!binding} onClick={() => void unpair()}>
                {t("project.config.integrations.telegram.unpair")}
              </Button>
            </div>

            {pairingCode ? <p className="rounded-md bg-muted px-3 py-2 font-mono text-sm">{pairingCode.command}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
