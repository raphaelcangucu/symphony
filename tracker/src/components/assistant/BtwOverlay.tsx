import { X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";

export type BtwStatus = "streaming" | "complete" | "error";

interface BtwOverlayProps {
  question: string;
  answer: string;
  status: BtwStatus;
  onClose: () => void;
}

export function BtwOverlay({ question, answer, status, onClose }: BtwOverlayProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={t("assistant.btw.ariaLabel")}
        className="w-full max-w-lg rounded-2xl border bg-card p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("assistant.btw.title")}</p>
          <button
            type="button"
            aria-label={t("assistant.btw.closeAria")}
            onClick={onClose}
            className="rounded p-0.5 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-sm font-medium">{question}</p>
        <div className={cn("text-sm", status === "error" && "text-destructive")}>
          {status === "streaming" && answer.length === 0 ? (
            <span className="text-muted-foreground">{t("assistant.btw.thinking")}</span>
          ) : (
            <Markdown className="max-w-none text-sm leading-7">{answer}</Markdown>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("assistant.btw.footer")}</p>
      </div>
    </div>
  );
}
