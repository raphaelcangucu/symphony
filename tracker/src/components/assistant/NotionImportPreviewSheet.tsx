import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Markdown } from "@/components/ui/markdown";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import { fetchNotionImport, type NotionImportDetail } from "@/services/notion";

interface NotionImportPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importId: string | null;
}

export function NotionImportPreviewSheet({ open, onOpenChange, importId }: NotionImportPreviewSheetProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<NotionImportDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || !importId) {
      setDetail(null);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);
    setDetail(null);

    void fetchNotionImport(importId)
      .then((next) => {
        if (!cancelled) {
          setDetail(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [importId, open]);

  const title =
    typeof detail?.meta?.title === "string" && detail.meta.title.trim()
      ? detail.meta.title.trim()
      : t("assistant.notionImport.previewTitle");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        data-testid="notion-import-preview-sheet"
      >
        <SheetHeader className="space-y-1 border-b px-4 py-3 pr-12 text-left">
          <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {title}
          </SheetTitle>
          <SheetDescription className="text-[11px] text-muted-foreground">
            {t("assistant.notionImport.previewDescription")}
          </SheetDescription>
        </SheetHeader>

        <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", SCROLLBAR_THIN)}>
          {loading ? <p className="text-sm text-muted-foreground">{t("assistant.notionImport.loading")}</p> : null}
          {error ? <p className="text-sm text-destructive">{t("assistant.notionImport.loadError")}</p> : null}

          {!loading && !error && detail ? (
            <div className="space-y-4">
              <Markdown>{detail.markdown}</Markdown>

              <section className="space-y-2" data-testid="notion-import-assets">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("assistant.notionImport.assetsHeading")}
                </h3>
                {detail.assets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("assistant.notionImport.noAssets")}</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-4 text-sm">
                    {detail.assets.map((asset) => (
                      <li key={asset} className="break-all">
                        {asset}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
