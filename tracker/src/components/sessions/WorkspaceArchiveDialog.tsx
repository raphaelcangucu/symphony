import { Archive, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { cn, formatRelativeTime, SCROLLBAR_THIN } from "@/lib/utils";
import { archiveAssistantThread, deleteAssistantThread } from "@/services/assistantThreads";
import type { RecentSession } from "@/types/recents";

export interface WorkspaceArchiveDialogProps {
  sessions: readonly RecentSession[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

type ArchiveCandidate = {
  key: string;
  threadId: number;
  title: string;
  meta: string;
};

export function WorkspaceArchiveDialog({
  sessions,
  open,
  onOpenChange,
  onDone,
}: WorkspaceArchiveDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const candidates = useMemo(() => collectArchiveCandidates(sessions), [sessions]);
  const allSelected = candidates.length > 0 && selected.size === candidates.length;
  const someSelected = selected.size > 0 && !allSelected;

  useEffect(() => {
    if (!open) {
      setConfirmDelete(false);
      return;
    }
    setSelected(new Set(candidates.map((entry) => entry.threadId)));
    setConfirmDelete(false);
  }, [candidates, open]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  function toggle(threadId: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(candidates.map((entry) => entry.threadId)));
  }

  async function runArchive() {
    if (busy || selected.size === 0) return;
    setBusy(true);
    try {
      const threadIds = [...selected];
      const results = await Promise.allSettled(
        threadIds.map((threadId) => archiveAssistantThread(threadId)),
      );
      const archived = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - archived;
      if (failed > 0) {
        toast.warning(
          t("workspacesPage.archive.partial", {
            archived,
            failed,
            defaultValue: "{{archived}} archived, {{failed}} failed",
          }),
        );
      } else {
        toast.success(
          t("workspacesPage.archive.done", {
            count: archived,
            defaultValue: "Archived {{count}} sessions",
          }),
        );
      }
      onOpenChange(false);
      onDone();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("workspacesPage.archive.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    if (busy || selected.size === 0) return;
    setBusy(true);
    try {
      const threadIds = [...selected];
      const results = await Promise.allSettled(
        threadIds.map((threadId) => deleteAssistantThread(threadId)),
      );
      const deleted = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - deleted;
      if (failed > 0) {
        toast.warning(
          t("workspacesPage.archive.deletePartial", {
            deleted,
            failed,
            defaultValue: "{{deleted}} deleted, {{failed}} failed",
          }),
        );
      } else {
        toast.success(
          t("workspacesPage.archive.deleteDone", {
            count: deleted,
            defaultValue: "Deleted {{count}} sessions",
          }),
        );
      }
      onOpenChange(false);
      onDone();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : t("workspacesPage.archive.deleteFailed"),
      );
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t("workspacesPage.archive.title", { defaultValue: "Archive sessions" })}
          </DialogTitle>
          <DialogDescription>
            {t("workspacesPage.archive.description", {
              defaultValue:
                "Archive chats to clear the list, or permanently delete history and logs. Working trees are unchanged — use Clean up for disk.",
            })}
          </DialogDescription>
        </DialogHeader>

        {confirmDelete ? (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3">
            <p className="text-sm font-medium text-destructive">
              {t("workspacesPage.archive.deleteConfirmTitle", {
                count: selected.size,
                defaultValue: "Permanently delete {{count}} sessions?",
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("workspacesPage.archive.deleteConfirmBody", {
                defaultValue:
                  "This deletes thread history, logs, and attachments. It cannot be undone. Trees on disk are not removed.",
              })}
            </p>
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              {t("workspacesPage.archive.backToSelection", { defaultValue: "Back to selection" })}
            </button>
          </div>
        ) : candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("workspacesPage.archive.empty", { defaultValue: "No sessions to archive." })}
          </p>
        ) : (
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2 px-1 text-sm text-muted-foreground">
              <input
                ref={selectAllRef}
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={allSelected}
                onChange={toggleSelectAll}
                disabled={busy}
              />
              {t("workspacesPage.archive.selectAll", { defaultValue: "Select all" })}
            </label>
            <ul className={cn("max-h-72 space-y-1.5 overflow-y-auto", SCROLLBAR_THIN)}>
              {candidates.map((entry) => (
                <li key={entry.key}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border/50 bg-background/60 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={selected.has(entry.threadId)}
                      onChange={() => toggle(entry.threadId)}
                      disabled={busy}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {entry.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {entry.meta}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>
              {t("workspacesPage.cleanup.cancel")}
            </Button>
          </DialogClose>
          {confirmDelete ? (
            <Button
              type="button"
              variant="destructive"
              disabled={busy || selected.size === 0}
              onClick={() => void runDelete()}
            >
              <Trash2 className="h-4 w-4" />
              {busy
                ? t("workspacesPage.archive.deleting", { defaultValue: "Deleting…" })
                : t("workspacesPage.archive.confirmDelete", {
                    defaultValue: "Confirm delete",
                  })}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy || selected.size === 0}
                onClick={() => void runArchive()}
              >
                <Archive className="h-4 w-4" />
                {busy
                  ? t("workspacesPage.archive.archiving", { defaultValue: "Archiving…" })
                  : t("workspacesPage.archive.confirm", {
                      count: selected.size,
                      defaultValue: "Archive ({{count}})",
                    })}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || selected.size === 0}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4" />
                {t("workspacesPage.archive.delete", { defaultValue: "Delete…" })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function collectArchiveCandidates(sessions: readonly RecentSession[]): ArchiveCandidate[] {
  const seen = new Set<number>();
  const candidates: ArchiveCandidate[] = [];

  for (const session of sessions) {
    if (session.threadId == null || seen.has(session.threadId)) continue;
    seen.add(session.threadId);
    candidates.push({
      key: session.id,
      threadId: session.threadId,
      title: session.title,
      meta: [
        session.identifier,
        session.scope,
        formatRelativeTime(session.updatedAt),
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  return candidates;
}
