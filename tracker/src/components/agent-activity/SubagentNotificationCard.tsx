import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ActivityDisclosure } from "@/components/agent-activity/ActivityDisclosure";
import { useSubagentDrawer } from "@/components/agent-activity/subagentDrawerContext";
import { ASSISTANT_CHAT_MESSAGE_TEXT_CLASS } from "@/components/assistant/chatTypography";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import type { SubagentNotification } from "@/lib/subagentNotification";
import { cn } from "@/lib/utils";

const TONE_BADGE_STYLES: Record<SubagentNotification["tone"], string> = {
  success: "bg-emerald-500/10 text-emerald-600",
  warning: "bg-amber-500/10 text-amber-600",
  failure: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

interface SubagentNotificationCardProps {
  notification: SubagentNotification;
}

export function SubagentNotificationCard({ notification }: SubagentNotificationCardProps) {
  const { t } = useTranslation();
  const drawer = useSubagentDrawer();
  const { agentId, headline, tone, detail } = notification;

  const showViewActivity =
    drawer != null && typeof agentId === "string" && agentId.length > 0;

  return (
    <div className="space-y-1">
      <ActivityDisclosure
        icon={<Bot className="size-3.5" aria-hidden />}
        label={
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate">{t("issue.toolCall.subagent.notification")}</span>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                TONE_BADGE_STYLES[tone],
              )}
              data-testid="subagent-notification-headline"
            >
              {headline}
            </span>
          </span>
        }
        details={
          detail ? (
            <Markdown className={cn(ASSISTANT_CHAT_MESSAGE_TEXT_CLASS, "max-w-none")}>
              {detail}
            </Markdown>
          ) : null
        }
        defaultExpanded={false}
        testId="subagent-notification-card"
      />
      {showViewActivity ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 px-2 text-xs"
            data-testid="subagent-notification-view-activity"
            onClick={() => drawer.openSubagent({ resolve: "id", id: agentId })}
          >
            {t("issue.toolCall.subagent.viewActivity")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
