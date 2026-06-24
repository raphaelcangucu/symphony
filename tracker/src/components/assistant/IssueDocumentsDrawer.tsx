import { FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DocumentViewer } from "@/components/assistant/DocumentViewer";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIssueDocuments } from "@/hooks/useIssueDocuments";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";

interface IssueDocumentsDrawerProps {
  projectSlug: string;
  identifier: string;
  refreshKey?: number;
}

export function IssueDocumentsDrawer({ projectSlug, identifier, refreshKey = 0 }: IssueDocumentsDrawerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const normalizedIdentifier = normalizeIssueIdentifier(identifier) || null;
  const issueDocuments = useIssueDocuments({
    projectSlug,
    identifier: normalizedIdentifier,
    enabled: normalizedIdentifier !== null,
    refreshKey,
  });

  if (!normalizedIdentifier) return null;

  const documentCount = issueDocuments.documents.length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 gap-1.5 px-2.5 text-xs">
          <FileText className="h-3.5 w-3.5" />
          {t("assistant.authoring.openDocuments")}
          {documentCount > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-semibold tabular-nums text-primary">
              {documentCount}
            </span>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex h-full w-full max-w-none flex-col overflow-hidden p-0 sm:w-[min(1280px,calc(100vw-0.75rem))]"
      >
        <SheetHeader className="shrink-0 space-y-1 border-b px-6 py-4 pr-14 text-left">
          <SheetTitle>{t("assistant.authoring.documentsDrawerTitle")}</SheetTitle>
          <SheetDescription>{t("assistant.authoring.documentsDrawerDescription")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-hidden" aria-label={t("assistant.authoring.documentsAria")}>
          <DocumentViewer
            projectSlug={projectSlug}
            identifier={normalizedIdentifier}
            documents={issueDocuments.documents}
            available={issueDocuments.available}
            reason={issueDocuments.reason}
            layout="stacked"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
