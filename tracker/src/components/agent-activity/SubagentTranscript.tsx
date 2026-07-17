import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { AssistantMessageList } from "@/components/assistant/AssistantMessageList";
import { useSubagentChannel } from "@/hooks/useSubagentChannel";
import { adaptSessionLogEntries } from "@/lib/sessionLogFeed";

export interface SubagentTranscriptProps {
  projectSlug: string;
  parentSessionId: number;
  agentKind: string;
  subagentId: string;
  toolUseId?: string | null;
  enabled: boolean;
}

/**
 * Read-only subagent session-log transcript.
 * Uses AssistantMessageList in feedItems mode with stub interactive callbacks
 * (same pattern as ExecutionSessionPanel).
 */
export function SubagentTranscript({
  projectSlug,
  parentSessionId,
  agentKind,
  subagentId,
  toolUseId = null,
  enabled,
}: SubagentTranscriptProps) {
  const { t } = useTranslation();
  const { entries, connected, error, meta } = useSubagentChannel({
    projectSlug,
    parentSessionId,
    agentKind,
    subagentId,
    toolUseId,
    enabled,
  });

  const feedItems = useMemo(() => adaptSessionLogEntries(entries), [entries]);

  if (error) {
    return (
      <p className="px-1 py-4 text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }

  if (!connected && feedItems.length === 0) {
    return (
      <p className="px-1 py-4 text-sm text-muted-foreground">{t("issue.toolCall.subagent.loading")}</p>
    );
  }

  if (feedItems.length === 0) {
    return (
      <p className="px-1 py-4 text-sm text-muted-foreground">{t("issue.toolCall.subagent.empty")}</p>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3" data-testid="subagent-transcript" data-meta-label={meta.label ?? undefined}>
      <AssistantMessageList
        feedItems={feedItems}
        taskSnapshot={null}
        hidePinnedPanel
        projectSlug={projectSlug}
        threadId={parentSessionId}
        isRunning={false}
        runningStartedAt={null}
        activeToolDetail={null}
        connectionError={null}
        channelReady={connected}
        planApprovalMessageId={null}
        onInsertContext={() => {
          /* Read-only subagent drawer — no composer. */
        }}
        onApprovePlan={() => {
          /* Plan approval is interactive-only. */
        }}
      />
    </div>
  );
}
