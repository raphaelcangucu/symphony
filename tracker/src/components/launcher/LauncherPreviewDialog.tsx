import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { LauncherDataItem } from "@/components/launcher/useLauncherData";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getIssue } from "@/services/issues";
import type { Issue } from "@/types/issue";
import type { LauncherTabId } from "@/types/launcher";

export interface LauncherPreviewTarget {
  item: LauncherDataItem;
  tab: LauncherTabId;
}

export interface LauncherPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  target: LauncherPreviewTarget | null;
  onOpenIssue?: (issueIdentifier: string) => void;
}

function excerpt(text: string | null | undefined, max = 480): string | null {
  if (!text?.trim()) return null;
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

export function LauncherPreviewDialog({
  open,
  onOpenChange,
  projectSlug,
  target,
  onOpenIssue,
}: LauncherPreviewDialogProps) {
  const { t } = useTranslation();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(false);

  const issueIdentifier = target?.item.issueIdentifier ?? null;

  useEffect(() => {
    if (!open || !issueIdentifier || !projectSlug) {
      setIssue(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void getIssue(projectSlug, issueIdentifier)
      .then((next) => {
        if (!cancelled) setIssue(next);
      })
      .catch(() => {
        if (!cancelled) setIssue(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, issueIdentifier, projectSlug]);

  if (!target) return null;

  const { item, tab } = target;
  const title = issue?.title ?? item.title;
  const subtitle =
    tab === "prs"
      ? item.subtitle
      : tab === "branches"
        ? item.subtitle
        : issue?.identifier ?? item.issueIdentifier ?? item.id;
  const description = excerpt(issue?.description);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-8">{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {loading ? <p className="text-muted-foreground">{t("launcher.preview.loading")}</p> : null}
          {!loading && issue ? (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{issue.identifier}</span>
              <span>·</span>
              <span>{issue.status}</span>
              {issue.branchName ? (
                <>
                  <span>·</span>
                  <span className="font-mono">{issue.branchName}</span>
                </>
              ) : null}
            </div>
          ) : null}
          {!loading && !issue && tab !== "issues" ? (
            <p className="text-muted-foreground">{t("launcher.preview.noIssueLinked")}</p>
          ) : null}
          {description ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
              {description}
            </pre>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {item.externalUrl ? (
            <Button variant="outline" size="sm" asChild>
              <a href={item.externalUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                {t("launcher.preview.openExternal")}
              </a>
            </Button>
          ) : (
            <span />
          )}
          {issueIdentifier && onOpenIssue ? (
            <Button size="sm" onClick={() => onOpenIssue(issueIdentifier)}>
              {t("launcher.preview.openIssue")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
