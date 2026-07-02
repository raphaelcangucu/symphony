import { FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AssistantKbDocumentsPanel } from "@/components/assistant/AssistantKbDocumentsPanel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";

interface IssueDocumentsDrawerProps {
  projectSlug: string;
  identifier: string;
}

export function IssueDocumentsDrawer({ projectSlug, identifier }: IssueDocumentsDrawerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const normalizedIdentifier = normalizeIssueIdentifier(identifier) || null;

  if (!normalizedIdentifier) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 gap-1.5 px-2.5 text-xs">
          <FileText className="h-3.5 w-3.5" />
          {t("assistant.authoring.openDocuments")}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex h-full w-full max-w-none flex-col overflow-hidden p-0 sm:w-[min(1280px,calc(100vw-0.75rem))]"
      >
        <SheetHeader className="shrink-0 space-y-1 border-b px-6 py-4 pr-14 text-left">
          <SheetTitle>{t("kb.assistantDocuments.title")}</SheetTitle>
          <SheetDescription>{t("kb.home.intro")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-hidden" aria-label={t("assistant.authoring.documentsAria")}>
          <AssistantKbDocumentsPanel
            projectSlug={projectSlug}
            issueIdentifier={normalizedIdentifier}
            citedPaths={[]}
            className="rounded-none border-0 shadow-none"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
