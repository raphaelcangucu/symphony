import { FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { KnowledgeBaseModal } from "@/components/kb/KnowledgeBaseModal";
import { sessionToolbarLabeledButtonClassName } from "@/components/sessions/sessionToolbarStyles";
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
        className={sessionToolbarLabeledButtonClassName}
        onClick={() => setOpen(true)}
        aria-label={t("assistant.authoring.openDocuments")}
        title={t("assistant.authoring.openDocuments")}
      >
        <FileText className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("assistant.authoring.openDocuments")}</span>
      </Button>
      <KnowledgeBaseModal open={open} projectSlug={projectSlug} onOpenChange={setOpen} />
    </>
  );
}
