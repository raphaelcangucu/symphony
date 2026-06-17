import { ArrowLeft, Loader2 } from "lucide-react";
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  evidenceAttentionInstructions,
  evidenceAttentionSummary,
  type EvidenceAttention,
} from "@/lib/evidenceStatus";
import {
  returnToAgentTemplateLabel,
  returnToAgentTemplateText,
  type ReturnToAgentTemplate,
} from "@/lib/returnToAgent";
import type { WorkflowTrackerConfig } from "@/lib/workflowTracker";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import type { Issue } from "@/types/issue";

const TEMPLATE_OPTIONS: ReturnToAgentTemplate[] = ["evidence", "fix", "review_feedback", "custom"];

function buildInitialInstructions(
  template: ReturnToAgentTemplate,
  evidenceAttention: EvidenceAttention | undefined,
  t: TFunction,
): string {
  if (template === "custom") return "";

  const base = returnToAgentTemplateText(template, t);
  if (template !== "evidence" || !evidenceAttention || evidenceAttention.kind !== "failed") {
    return base;
  }

  const failedContext = evidenceAttentionInstructions(evidenceAttention, t);
  return failedContext ? `${base}\n\n${failedContext}` : base;
}

interface ReturnToAgentPanelProps {
  projectSlug: string;
  issue: Issue;
  trackerConfig: WorkflowTrackerConfig;
  evidenceAttention?: EvidenceAttention;
  initialTemplate?: ReturnToAgentTemplate | null;
  onIssueUpdated?: (issue: Issue) => void;
}

export function ReturnToAgentPanel({
  projectSlug,
  issue,
  trackerConfig,
  evidenceAttention,
  initialTemplate = null,
  onIssueUpdated,
}: ReturnToAgentPanelProps) {
  const { t } = useTranslation();
  const [template, setTemplate] = useState<ReturnToAgentTemplate>(initialTemplate ?? "evidence");
  const [instructions, setInstructions] = useState(() =>
    buildInitialInstructions(initialTemplate ?? "evidence", evidenceAttention, t),
  );
  const [pending, setPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const reworkTarget = trackerConfig.reworkTarget ?? "Em andamento";

  const summaryLine = useMemo(() => {
    const parts = [t("issue.returnToAgent.statusLine", { status: issue.status })];
    if (evidenceAttention?.kind === "missing") {
      parts.push(t("issue.evidence.absent"));
    } else if (evidenceAttention?.kind === "failed") {
      parts.push(`Evidence: ${evidenceAttentionSummary(evidenceAttention, t)}`);
    }
    return parts.join(" · ");
  }, [evidenceAttention, issue.status, t]);

  function selectTemplate(next: ReturnToAgentTemplate) {
    setTemplate(next);
    setInstructions(buildInitialInstructions(next, evidenceAttention, t));
  }

  async function continueWork() {
    setPending(true);
    setStatusMessage(null);

    try {
      const result = await dispatchIssueAgent(projectSlug, issue.identifier, {
        action: "continue_work",
        targetStatus: reworkTarget,
        instructions: instructions.trim() || null,
      });
      onIssueUpdated?.(result.issue);
      setStatusMessage(result.message);
      toast.success(t("issue.returnToAgent.resumeToast", { target: reworkTarget }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("issue.returnToAgent.resumeFailed");
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-amber-500/15 p-2 text-amber-700 dark:text-amber-300">
          <ArrowLeft className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">
            {evidenceAttention?.kind === "failed"
              ? t("issue.returnToAgent.resumeValidation")
              : t("issue.returnToAgent.returnToAgent")}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {evidenceAttention?.kind === "failed"
              ? t("issue.returnToAgent.failedGateDescription", { target: reworkTarget })
              : t("issue.returnToAgent.humanReviewDescription", { target: reworkTarget })}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">{summaryLine}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {TEMPLATE_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            disabled={pending}
            onClick={() => selectTemplate(option)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              template === option
                ? "border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-100"
                : "border-border/70 bg-background/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {returnToAgentTemplateLabel(option, t)}
          </button>
        ))}
      </div>

      <Textarea
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        disabled={pending}
        rows={8}
        placeholder={t("issue.returnToAgent.instructionsPlaceholder")}
        className="mt-3 min-h-0 resize-y text-sm"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => void continueWork()}>
          {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {pending
            ? t("issue.returnToAgent.resuming")
            : t("issue.returnToAgent.resumeButton", { target: reworkTarget })}
        </Button>
        {statusMessage ? <span className="text-xs text-muted-foreground">{statusMessage}</span> : null}
      </div>
    </section>
  );
}
