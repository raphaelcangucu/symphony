import { FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { KnowledgeBaseModal } from "@/components/kb/KnowledgeBaseModal";
import {
  sessionToolbarIconButtonClassName,
  sessionToolbarLabeledButtonClassName,
} from "@/components/sessions/sessionToolbarStyles";
import { Button } from "@/components/ui/button";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { cn } from "@/lib/utils";

interface IssueDocumentsDrawerProps {
  projectSlug: string;
  identifier: string;
  /** Icon-only trigger for dense session header toolbars. */
  compact?: boolean;
}

export function IssueDocumentsDrawer({
  projectSlug,
  identifier,
  compact = false,
}: IssueDocumentsDrawerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const normalizedIdentifier = normalizeIssueIdentifier(identifier) || null;

  if (!normalizedIdentifier) return null;

  const label = t("assistant.authoring.openDocuments");

  return (
    <>
      <Button
        type="button"
        variant={compact ? "ghost" : "outline"}
        size="sm"
        className={cn(compact ? sessionToolbarIconButtonClassName : sessionToolbarLabeledButtonClassName)}
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
      >
        <FileText className="h-4 w-4" />
        {compact ? null : <span>{label}</span>}
      </Button>
      <KnowledgeBaseModal open={open} projectSlug={projectSlug} onOpenChange={setOpen} />
    </>
  );
}
