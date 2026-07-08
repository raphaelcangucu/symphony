import { useTranslation } from "react-i18next";

import { StatusPill } from "@/components/ui/status-pill";
import { executionStatusTone } from "@/lib/statusPresentation";
import type { AgentExecutionStatus } from "@/types/agent-execution";

export function SessionStatusBadge({ status }: { status: AgentExecutionStatus }) {
  const { t } = useTranslation();

  return <StatusPill tone={executionStatusTone(status)}>{t(`sessions.status.${status}`)}</StatusPill>;
}
