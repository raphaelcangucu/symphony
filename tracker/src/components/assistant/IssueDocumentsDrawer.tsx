import { BookOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { KnowledgeBaseModal } from "@/components/kb/KnowledgeBaseModal";
import {
  sessionToolbarIconButtonClassName,
  sessionToolbarLabeledButtonClassName,
} from "@/components/sessions/sessionToolbarStyles";
import { Button } from "@/components/ui/button";
import { useIssueChangedDocPaths } from "@/hooks/useIssueChangedDocPaths";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { cn } from "@/lib/utils";

interface IssueDocumentsDrawerProps {
  projectSlug: string;
  identifier: string;
  /** Icon-only trigger for dense session header toolbars. */
  compact?: boolean;
  /** Controlled open state when sharing the modal with the composer KB button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Bump to refresh changed-doc paths (e.g. assistant_document_changed). */
  refreshKey?: number;
  /** When true, this instance only renders the trigger (modal owned elsewhere). */
  triggerOnly?: boolean;
  /** Optional shared paths when the parent already loaded changed docs. */
  changedDocPaths?: string[];
  changedDocCount?: number;
}

export function IssueDocumentsDrawer({
  projectSlug,
  identifier,
  compact = false,
  open: openProp,
  onOpenChange,
  refreshKey = 0,
  triggerOnly = false,
  changedDocPaths: changedDocPathsProp,
  changedDocCount: changedDocCountProp,
}: IssueDocumentsDrawerProps) {
  const { t } = useTranslation();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const normalizedIdentifier = normalizeIssueIdentifier(identifier) || null;
  const controlled = typeof openProp === "boolean";
  const open = controlled ? Boolean(openProp) : uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const loaded = useIssueChangedDocPaths({
    projectSlug,
    issueIdentifier: normalizedIdentifier,
    enabled: changedDocPathsProp === undefined,
    refreshKey,
  });
  const paths = changedDocPathsProp ?? loaded.paths;
  const count = changedDocCountProp ?? loaded.count;

  if (!normalizedIdentifier) return null;

  const label = t("assistant.authoring.openDocuments");

  return (
    <>
      <Button
        type="button"
        variant={compact ? "ghost" : "outline"}
        size="sm"
        className={cn(
          "relative",
          compact ? sessionToolbarIconButtonClassName : sessionToolbarLabeledButtonClassName,
        )}
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
      >
        <BookOpen className="h-4 w-4 shrink-0" />
        {compact ? null : <span>{label}</span>}
        {count > 0 ? (
          <span
            aria-hidden
            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500"
            data-testid="changed-docs-dot"
          />
        ) : null}
      </Button>
      {triggerOnly ? null : (
        <KnowledgeBaseModal
          open={open}
          projectSlug={projectSlug}
          issueIdentifier={normalizedIdentifier}
          changedDocPaths={paths}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
