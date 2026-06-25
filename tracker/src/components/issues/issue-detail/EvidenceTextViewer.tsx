import { FileText, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchEvidenceArtifactText } from "@/services/evidence";
import { cn } from "@/lib/utils";

interface EvidenceTextViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  url: string;
}

export function EvidenceTextViewer({ open, onOpenChange, title, url }: EvidenceTextViewerProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    if (!open) {
      setContent(null);
      setError(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);
    setContent(null);

    void fetchEvidenceArtifactText(url)
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, reloadCounter, url]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4 shrink-0 opacity-80" />
            <span className="truncate">{title}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto p-4" aria-live="polite">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("issue.evidence.tab.textViewer.loading")}
            </div>
          ) : null}

          {!loading && error ? (
            <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm font-medium text-destructive">
                {t("issue.evidence.tab.textViewer.loadError")}
              </p>
              <Button
                onClick={() => setReloadCounter((current) => current + 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("issue.evidence.tab.textViewer.retry")}
              </Button>
            </div>
          ) : null}

          {!loading && !error && content !== null ? (
            <pre className={cn("whitespace-pre-wrap break-words font-mono text-xs leading-relaxed")}>
              {content}
            </pre>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface EvidenceTextViewerTriggerProps {
  label: string;
  title: string;
  url: string;
  className?: string;
}

export function EvidenceTextViewerTrigger({
  label,
  title,
  url,
  className,
}: EvidenceTextViewerTriggerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        aria-label={t("issue.evidence.tab.textViewer.openAria", { name: title })}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs text-primary transition hover:bg-muted/60",
          className,
        )}
        onClick={() => setOpen(true)}
        type="button"
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      <EvidenceTextViewer onOpenChange={setOpen} open={open} title={title} url={url} />
    </>
  );
}
