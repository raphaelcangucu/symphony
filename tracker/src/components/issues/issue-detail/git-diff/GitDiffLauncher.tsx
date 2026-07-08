import { GitCompare } from "lucide-react";
import { lazy, Suspense, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useGitDiffShortcut } from "@/hooks/useGitDiffShortcut";

const GitDiffModal = lazy(() => import("@/components/issues/issue-detail/git-diff/GitDiffModal"));

interface GitDiffLauncherProps {
  projectSlug?: string;
  identifier?: string | null;
  threadId?: number | null;
  disabled?: boolean;
  /** Enables diff line comments; receives the composed review prompt to deliver to the agent. */
  onSendReview?: (review: string) => void;
}

export function GitDiffLauncher({
  projectSlug,
  identifier = null,
  threadId = null,
  disabled,
  onSendReview,
}: GitDiffLauncherProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const unavailable = !identifier && !threadId;
  const launcherDisabled = disabled || unavailable;
  const openModal = useCallback(() => {
    if (launcherDisabled) return;
    setOpen(true);
  }, [launcherDisabled]);

  useGitDiffShortcut(openModal, { enabled: !launcherDisabled });

  return (
    <>
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
      {open ? (
        <Suspense fallback={null}>
          <GitDiffModal
            open={open}
            onOpenChange={setOpen}
            projectSlug={projectSlug}
            identifier={identifier}
            threadId={threadId}
            onSendReview={onSendReview}
          />
        </Suspense>
      ) : null}
    </>
  );
}
