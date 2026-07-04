import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface InstallActionButtonProps {
  installed: boolean;
  command: string | null;
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function InstallActionButton({ installed, command }: InstallActionButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (installed) {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        <Check className="mr-1.5 h-3.5 w-3.5" />
        {t("settings.agentTool.install.installed")}
      </Button>
    );
  }

  async function handleClick() {
    if (!command) return;
    const ok = await copyToClipboard(command);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success(t("settings.agentTool.install.copied"));
    } else {
      toast.error(t("settings.agentTool.install.copyFailed"));
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      disabled={!command}
      onClick={() => void handleClick()}
      title={command ?? undefined}
    >
      {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : command ? <Copy className="mr-1.5 h-3.5 w-3.5" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
      {t("settings.agentTool.install.action")}
    </Button>
  );
}
