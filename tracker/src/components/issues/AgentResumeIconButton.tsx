import { Play } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { canResumeExecution, resolveDisplayStatus } from "@/lib/agentExecutionDisplay";
import { cn } from "@/lib/utils";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

interface AgentResumeIconButtonProps {
  projectSlug: string;
  issueIdentifier: string;
  execution: AgentExecution;
  onIssueUpdated?: (issue: Issue) => void;
  className?: string;
}

export function shouldShowResumeIcon(execution?: AgentExecution): boolean {
  if (!execution || !canResumeExecution(execution)) return false;
  const status = resolveDisplayStatus(execution);
  return status === "aborted" || status === "error";
}

export function AgentResumeIconButton({
  projectSlug,
  issueIdentifier,
  execution,
  onIssueUpdated,
  className,
}: AgentResumeIconButtonProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);

  if (!shouldShowResumeIcon(execution)) return null;

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    event.preventDefault();
    if (pending) return;

    setPending(true);
    try {
      const result = await dispatchIssueAgent(projectSlug, issueIdentifier, { action: "resume" });
      onIssueUpdated?.(result.issue);
      toast.success(result.message || t("issue.agent.dispatchResume"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.agent.dispatchFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={(event) => void handleClick(event)}
      disabled={pending}
      aria-label={t("issue.agent.primaryResume")}
      title={t("issue.agent.primaryResume")}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm p-0.5 text-rose-600 transition-colors hover:bg-rose-500/10 hover:text-rose-700 disabled:opacity-50 dark:text-rose-300 dark:hover:text-rose-200",
        pending && "animate-pulse",
        className,
      )}
    >
      <Play className="h-3 w-3" />
    </button>
  );
}
