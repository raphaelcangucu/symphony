import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/workspaceCards";

export interface WorkspaceRemoveTarget {
  path: string;
  title: string;
  sizeBytes: number;
  workPresent: boolean;
  threadIds: number[];
}

interface WorkspaceRemoveDialogProps {
  target: WorkspaceRemoveTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (target: WorkspaceRemoveTarget) => Promise<void>;
}

export function WorkspaceRemoveDialog({
  target,
  open,
  onOpenChange,
  onConfirm,
}: WorkspaceRemoveDialogProps) {
  const { t } = useTranslation();
  const [removing, setRemoving] = useState(false);

  async function handleConfirm() {
    if (!target || removing) return;
    setRemoving(true);
    try {
      await onConfirm(target);
      onOpenChange(false);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("workspacesPage.removeWorkspace.title", { defaultValue: "Remove workspace" })}
          </DialogTitle>
          <DialogDescription>
            {t("workspacesPage.removeWorkspace.description", {
              defaultValue:
                "This deletes the working tree from disk and archives linked sessions. It cannot be undone.",
            })}
          </DialogDescription>
        </DialogHeader>

        {target ? (
          <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm">
            <p className="font-medium text-foreground">{target.title}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{target.path}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(target.sizeBytes)}
              {target.threadIds.length > 0
                ? ` · ${t("workspacesPage.removeWorkspace.sessionCount", {
                    count: target.threadIds.length,
                    defaultValue: "{{count}} linked sessions",
                  })}`
                : null}
            </p>
            {target.workPresent ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t("workspacesPage.workPresentWarning")}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={removing}>
              {t("workspacesPage.cleanup.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={!target || removing}
            onClick={() => void handleConfirm()}
          >
            {removing
              ? t("workspacesPage.removeWorkspace.removing", { defaultValue: "Removing…" })
              : t("workspacesPage.sessionRows.remove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
