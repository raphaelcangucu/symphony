import type { TFunction } from "i18next";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";

import { issueAgentTabPath, issuePath, type WorkspaceView } from "@/lib/workspaceRoutes";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import { runPromptTemplate } from "@/services/magicCommands";
import type { LauncherTabId } from "@/types/launcher";

export type LauncherInvestigateTemplate = "investigate-issue" | "code-review";

export function resolveInvestigateTemplate(tab: LauncherTabId): LauncherInvestigateTemplate {
  return tab === "prs" ? "code-review" : "investigate-issue";
}

export async function openLauncherSession(args: {
  projectSlug: string;
  issueIdentifier: string;
  background: boolean;
  view: WorkspaceView;
  navigate: NavigateFunction;
  t: TFunction;
}): Promise<void> {
  const { projectSlug, issueIdentifier, background, view, navigate, t } = args;

  if (!background) {
    navigate(issueAgentTabPath(projectSlug, view, issueIdentifier, "execution"));
    return;
  }

  try {
    await dispatchIssueAgent(projectSlug, issueIdentifier, { action: "resume" });
    toast.success(t("launcher.toast.backgroundResume", { identifier: issueIdentifier }));
  } catch {
    toast.error(t("launcher.toast.dispatchFailed", { identifier: issueIdentifier }));
  }
}

export async function investigateLauncherItem(args: {
  projectSlug: string;
  issueIdentifier: string;
  template: LauncherInvestigateTemplate;
  background: boolean;
  view: WorkspaceView;
  navigate: NavigateFunction;
  t: TFunction;
}): Promise<void> {
  const { projectSlug, issueIdentifier, template, background, view, navigate, t } = args;

  try {
    await runPromptTemplate(projectSlug, issueIdentifier, template);
    if (!background) {
      navigate(issueAgentTabPath(projectSlug, view, issueIdentifier, "execution"));
    } else {
      toast.success(t("launcher.toast.backgroundInvestigate", { identifier: issueIdentifier }));
    }
  } catch {
    toast.error(t("launcher.toast.investigateFailed", { identifier: issueIdentifier }));
  }
}

/** Standalone PR/branch with no linked issue — Jean-style stack creates a new worktree. */
export async function stackStandaloneLauncherItem(args: {
  branchName: string;
  externalUrl: string | null;
  t: TFunction;
  prNumber?: number | null;
}): Promise<void> {
  const { t } = args;
  const label =
    args.prNumber != null
      ? t("launcher.toast.standaloneStackPendingPr", { number: args.prNumber, branch: args.branchName })
      : t("launcher.toast.standaloneStackPendingBranch", { branch: args.branchName });

  toast.message(label);

  if (args.externalUrl) {
    window.open(args.externalUrl, "_blank", "noopener");
  }
}

export function openLauncherPreviewNavigation(args: {
  projectSlug: string;
  issueIdentifier: string;
  view: WorkspaceView;
  navigate: NavigateFunction;
  tab: LauncherTabId;
}): void {
  const { projectSlug, issueIdentifier, view, navigate, tab } = args;
  const issueTab = tab === "prs" ? "pr" : "summary";
  navigate(issuePath(projectSlug, view, issueIdentifier, issueTab));
}
