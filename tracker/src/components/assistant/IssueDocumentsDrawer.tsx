import { FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { KnowledgeBaseModal } from "@/components/kb/KnowledgeBaseModal";
import { Button } from "@/components/ui/button";
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
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
        onClick={() => setOpen(true)}
      >
        <FileText className="h-3.5 w-3.5" />
        {t("assistant.authoring.openDocuments")}
      </Button>
      <KnowledgeBaseModal open={open} projectSlug={projectSlug} onOpenChange={setOpen} />
    </>
  );
}
