import { Plus, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { contextRefForApprovalRequest } from "@/components/assistant/assistantPanelHelpers";
import type { ComposerContextChipRef } from "@/components/assistant/contextMentions";
import { Button } from "@/components/ui/button";
import type { AssistantApprovalRequest } from "@/services/phoenix/assistantChannel";

export function CommandApprovalCard({
  request,
  disabled,
  onSubmit,
  onInsertContext,
}: {
  request: AssistantApprovalRequest;
  disabled?: boolean;
  onSubmit: (requestId: string | number, action: "approve" | "cancel") => void;
  onInsertContext?: (ref: ComposerContextChipRef) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-amber-300/60 bg-amber-50/70 p-3 text-sm shadow-sm dark:border-amber-400/30 dark:bg-amber-950/30">
      <div className="mb-2 flex items-center gap-2 font-semibold text-amber-950 dark:text-amber-100">
        <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-300" />
        <span>{t("assistant.panel.commandApproval.title")}</span>
      </div>
      {request.command ? (
        <pre className="mb-2 max-h-32 overflow-auto rounded-lg bg-background/80 px-3 py-2 font-mono text-xs text-foreground">
          {request.command}
        </pre>
      ) : null}
      <dl className="mb-3 space-y-1 text-xs text-muted-foreground">
        {request.cwd ? (
          <div>
            <dt className="font-medium text-foreground">{t("assistant.panel.commandApproval.cwd")}</dt>
            <dd className="break-all font-mono">{request.cwd}</dd>
          </div>
        ) : null}
        {request.reason ? (
          <div>
            <dt className="font-medium text-foreground">{t("assistant.panel.commandApproval.reason")}</dt>
            <dd>{request.reason}</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        {onInsertContext ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-3 text-xs"
            disabled={disabled}
            onClick={() => onInsertContext(contextRefForApprovalRequest(request, t))}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("assistant.panel.addToContext")}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          className="h-8 px-3 text-xs"
          disabled={disabled}
          onClick={() => onSubmit(request.requestId, "approve")}
        >
          {t("assistant.panel.commandApproval.approve")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 px-3 text-xs"
          disabled={disabled}
          onClick={() => onSubmit(request.requestId, "cancel")}
        >
          {t("assistant.panel.commandApproval.cancel")}
        </Button>
      </div>
    </div>
  );
}
