import { useTranslation } from "react-i18next";

import { STATUS_PILL_BASE, executionStatusBadgeClass } from "@/lib/statusPresentation";
import { cn } from "@/lib/utils";
import type { AgentExecutionStatus } from "@/types/agent-execution";

export function SessionStatusBadge({ status }: { status: AgentExecutionStatus }) {
  const { t } = useTranslation();

  return (
    <span className={cn(STATUS_PILL_BASE, executionStatusBadgeClass(status))}>
      {t(`sessions.status.${status}`)}
    </span>
  );
}
