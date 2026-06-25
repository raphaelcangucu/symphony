import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pause, Play, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { controlIssueGoal, type GoalControlAction } from "@/services/goalControl";
import type { AgentExecutionGoal } from "@/types/agent-execution";

interface GoalControlsProps {
  projectSlug: string;
  issueIdentifier: string;
  goal: AgentExecutionGoal;
  onChanged?: (goal: AgentExecutionGoal | null) => void;
}

/**
 * Operator controls for a native Codex goal. Each button maps to a
 * `thread/goal/*` mutation via the goal-control service; the persisted Codex
 * goal stays the source of truth.
 */
export function GoalControls({ projectSlug, issueIdentifier, goal, onChanged }: GoalControlsProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<GoalControlAction | null>(null);

  // Only native Codex goals expose mutation controls. Prompt-injected workflows
  // (Claude/Cursor) are view-only until they gain an equivalent native API.
  if (goal.kind !== "goal" || goal.source !== "native") return null;

  const capabilities = new Set(goal.capabilities);
  const isActive = goal.status === "active";
  const canPause = capabilities.has("pause") && isActive;
  const canResume = capabilities.has("resume") && !isActive;
  const canClear = capabilities.has("clear");

  if (!canPause && !canResume && !canClear) return null;

  async function run(action: GoalControlAction) {
    setPending(action);
    try {
      const result = await controlIssueGoal(projectSlug, issueIdentifier, { action });
      onChanged?.(result.cleared ? null : result.goal);
      toast.success(t(`issue.agent.goalControls.${action}Done`));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.agent.goalControls.failed"));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {canPause ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending !== null}
          onClick={() => run("pause")}
        >
          <Pause className="h-3.5 w-3.5" />
          {t("issue.agent.goalControls.pause")}
        </Button>
      ) : null}
      {canResume ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending !== null}
          onClick={() => run("resume")}
        >
          <Play className="h-3.5 w-3.5" />
          {t("issue.agent.goalControls.resume")}
        </Button>
      ) : null}
      {canClear ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending !== null}
          onClick={() => run("clear")}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("issue.agent.goalControls.clear")}
        </Button>
      ) : null}
    </div>
  );
}
