import { FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { fetchAttachmentObjectUrl } from "@/services/attachments";
import { cn } from "@/lib/utils";

interface AttachmentFileChipProps {
  src: string;
  name: string;
  className?: string;
}

export function AttachmentFileChip({ src, name, className }: AttachmentFileChipProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  async function open() {
    if (loading) return;
    setLoading(true);
    try {
      const url = await fetchAttachmentObjectUrl(src);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) toast.error(t("issue.attachments.popupBlocked"));
    } catch {
      toast.error(t("issue.attachments.openFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      title={t("issue.attachments.openTitle", { name })}
      aria-label={t("issue.attachments.openAria", { name })}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs transition-colors hover:bg-muted",
        className,
      )}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{name}</span>
    </button>
  );
}
