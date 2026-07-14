import { Check, Link2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

interface KbCopyGitHubLinkButtonProps {
  url: string;
  className?: string;
}

export function KbCopyGitHubLinkButton({ url, className }: KbCopyGitHubLinkButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(url);
    if (!ok) {
      toast.error(t("kb.editor.copyGitHubLinkFailed"));
      return;
    }
    setCopied(true);
    toast.success(t("kb.editor.copyGitHubLinkCopied"));
    window.setTimeout(() => setCopied(false), 2000);
  }, [t, url]);

  const Icon = copied ? Check : Link2;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="kb-copy-github-link"
            aria-label={t("kb.editor.copyGitHubLink")}
            onClick={() => void handleCopy()}
            className={cn(
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground",
              className,
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("kb.editor.copyGitHubLink")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
