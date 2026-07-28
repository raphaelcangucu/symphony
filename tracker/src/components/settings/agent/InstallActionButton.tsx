import { Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { runAgentLifecycle } from "@/services/settings";
import type { AgentKind } from "@/types/issue";

interface InstallActionButtonProps {
  agent: AgentKind;
  installed: boolean;
  onComplete?: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function InstallActionButton({ agent, installed, onComplete }: InstallActionButtonProps) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setRunning(true);
    setError(null);
    try {
      await runAgentLifecycle(agent, installed ? "update" : "install");
      onComplete?.();
    } catch (reason) {
      setError(errorMessage(reason, t("settings.agentTool.install.failed")));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" disabled={running} onClick={() => void handleClick()}>
        {installed ? (
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        ) : (
          <Download className="mr-1.5 h-3.5 w-3.5" />
        )}
        {running
          ? t("settings.agentTool.install.running")
          : installed
            ? t("settings.agentTool.install.update")
            : t("settings.agentTool.install.action")}
      </Button>
      {error ? (
        <p role="alert" className="max-w-sm text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
