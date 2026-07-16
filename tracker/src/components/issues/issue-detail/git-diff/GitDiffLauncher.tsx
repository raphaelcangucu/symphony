import { GitCompare, Loader2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGitDiffShortcut } from "@/hooks/useGitDiffShortcut";

const GitDiffModal = lazy(() => import("@/components/issues/issue-detail/git-diff/GitDiffModal"));

interface GitDiffLauncherProps {
  projectSlug?: string;
  identifier?: string | null;
  threadId?: number | null;
  disabled?: boolean;
  /** Enables diff line comments; receives the composed review prompt to deliver to the agent. */
  onSendReview?: (review: string) => void;
  /** External open trigger: incrementing this counter opens the modal (like other requestId props). */
  openRequestId?: number;
  /** External commit trigger: incrementing this counter opens the modal with its commit dialog. */
  openCommitDialogRequestId?: number;
  /** External focus trigger: incrementing this counter opens the modal focused on `focusPath`. */
  focusPathRequestId?: number;
  /** Path from chat edited-file chips (or similar) to select after open. */
  focusPath?: string | null;
  /** When false, only the modal + shortcut/requestId path remain (e.g. Environment dock Compare). */
  showTrigger?: boolean;
}

function GitDiffModalLoadingFallback({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[min(96vw,1200px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>{t("issue.diff.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("issue.diff.loading")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[320px] flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>{t("issue.diff.loading")}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GitDiffLauncher({
  projectSlug,
  identifier = null,
  threadId = null,
  disabled,
  onSendReview,
  openRequestId = 0,
  openCommitDialogRequestId = 0,
  focusPathRequestId = 0,
  focusPath = null,
  showTrigger = true,
}: GitDiffLauncherProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [openCommitDialog, setOpenCommitDialog] = useState(false);
  const [initialFocusPath, setInitialFocusPath] = useState<string | null>(null);
  const unavailable = !identifier && !threadId;
  const launcherDisabled = disabled || unavailable;
  const openModal = useCallback(() => {
    if (launcherDisabled) return;
    setOpen(true);
  }, [launcherDisabled]);

  useGitDiffShortcut(openModal, { enabled: !launcherDisabled });

  useEffect(() => {
    if (openRequestId > 0) openModal();
  }, [openModal, openRequestId]);

  useEffect(() => {
    if (openCommitDialogRequestId <= 0) return;
    setOpenCommitDialog(true);
    openModal();
  }, [openCommitDialogRequestId, openModal]);

  useEffect(() => {
    if (focusPathRequestId <= 0) return;
    const trimmed = typeof focusPath === "string" ? focusPath.trim() : "";
    if (trimmed) setInitialFocusPath(trimmed);
    openModal();
  }, [focusPath, focusPathRequestId, openModal]);

  return (
    <>
      {showTrigger ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2 text-xs"
          disabled={launcherDisabled}
          onClick={openModal}
          title={t("issue.diff.shortcutHint")}
        >
          <GitCompare className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("issue.diff.button")}</span>
        </Button>
      ) : null}
      {open ? (
        <Suspense fallback={<GitDiffModalLoadingFallback onOpenChange={setOpen} />}>
          <GitDiffModal
            open={open}
            onOpenChange={setOpen}
            projectSlug={projectSlug}
            identifier={identifier}
            threadId={threadId}
            onSendReview={onSendReview}
            initialCommitDialogOpen={openCommitDialog}
            onCommitDialogOpened={() => setOpenCommitDialog(false)}
            initialFocusPath={initialFocusPath}
            onInitialFocusConsumed={() => setInitialFocusPath(null)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
