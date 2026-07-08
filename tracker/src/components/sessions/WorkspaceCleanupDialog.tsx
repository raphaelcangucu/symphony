import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

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
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import { removeWorkspaces } from "@/services/worktrees";
import type { WorkspaceInventoryEntry } from "@/types/worktrees";

interface WorkspaceCleanupDialogProps {
  projectSlug: string;
  entries: WorkspaceInventoryEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCleaned: () => void;
}

export function WorkspaceCleanupDialog({
  projectSlug,
  entries,
  open,
  onOpenChange,
  onCleaned,
}: WorkspaceCleanupDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = useState(false);

  const candidates = useMemo(
    () => entries.filter((entry) => entry.removable && entry.kind !== "project"),
    [entries],
  );

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(candidates.filter((entry) => entry.reclaimable).map((entry) => entry.path)));
  }, [candidates, open]);

  const selectedBytes = useMemo(
    () => candidates.filter((entry) => selected.has(entry.path)).reduce((sum, entry) => sum + entry.sizeBytes, 0),
    [candidates, selected],
  );

  function toggle(path: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function handleConfirm() {
    if (removing || selected.size === 0) return;
    setRemoving(true);
    try {
      const results = await removeWorkspaces(projectSlug, [...selected]);
      const removed = results.filter((result) => result.status === "removed").length;
      const skipped = results.length - removed;
      if (skipped > 0) {
        toast.warning(t("workspacesPage.cleanup.partial", { removed, skipped }));
      } else {
        toast.success(t("workspacesPage.cleanup.done", { count: removed }));
      }
      onOpenChange(false);
      onCleaned();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("workspacesPage.cleanup.failed"));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("workspacesPage.cleanup.title")}</DialogTitle>
          <DialogDescription>{t("workspacesPage.cleanup.description")}</DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("workspacesPage.cleanup.empty")}</p>
        ) : (
          <ul className={cn("max-h-72 space-y-1.5 overflow-y-auto", SCROLLBAR_THIN)}>
            {candidates.map((entry) => (
              <li key={entry.path}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border/50 bg-background/60 px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={selected.has(entry.path)}
                    onChange={() => toggle(entry.path)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {entry.issueIdentifier ?? entry.name ?? entry.path.split("/").pop()}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{entry.path}</span>
                  </span>
                  {entry.workPresent ? (
                    <span
                      title={t("workspacesPage.workPresentWarning")}
                      className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatBytes(entry.sizeBytes)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={removing}>
              {t("workspacesPage.cleanup.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={removing || selected.size === 0}
            onClick={() => void handleConfirm()}
          >
            <Trash2 className="h-4 w-4" />
            {removing
              ? t("workspacesPage.cleanup.removing")
              : `${t("workspacesPage.cleanup.confirm")} (${formatBytes(selectedBytes)})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
