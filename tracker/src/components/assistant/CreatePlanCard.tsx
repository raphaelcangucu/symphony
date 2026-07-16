import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { resolveCreatePlanKbPath } from "@/lib/toolCallDisplay";

export interface CreatePlanRequest {
  requestId: string;
  name: string | null;
  overview: string | null;
  plan: string | null;
  planUri: string | null;
}

interface CreatePlanCardProps {
  request: CreatePlanRequest;
  onSubmit: (requestId: string, action: "accept" | "reject") => void;
  onOpenKbPath?: (path: string) => void;
  disabled?: boolean;
}

export function CreatePlanCard({ request, onSubmit, onOpenKbPath, disabled }: CreatePlanCardProps) {
  const { t } = useTranslation();
  const title = request.name?.trim() || t("assistant.createPlan.untitled");
  const overview = request.overview?.trim() || null;
  const planPreview = truncate(request.plan, 280);
  const kbPath = resolveCreatePlanKbPath({
    planUri: request.planUri,
    plan: request.plan,
  });

  return (
    <div className="rounded-2xl border bg-card p-3 shadow-sm" data-testid="create-plan-card">
      <p className="text-sm font-semibold">{t("assistant.createPlan.title", { name: title })}</p>
      {overview ? <p className="mt-1 text-sm text-muted-foreground">{overview}</p> : null}
      {planPreview ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs">
          {planPreview}
        </pre>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {kbPath && onOpenKbPath ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onOpenKbPath(kbPath)}
          >
            {t("issue.toolCall.openInKnowledgeBase")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onSubmit(request.requestId, "reject")}
        >
          {t("assistant.createPlan.reject")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => onSubmit(request.requestId, "accept")}
        >
          {t("assistant.createPlan.accept")}
        </Button>
      </div>
    </div>
  );
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
