import { PlayCircle } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import { IssueWorkingTreeToolbar } from "@/components/sessions/IssueWorkingTreeToolbar";
import { StartIssueSessionDialog } from "@/components/sessions/StartIssueSessionDialog";
import { Button } from "@/components/ui/button";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import type { Issue } from "@/types/issue";

const AuthoringPanel = memo(function AuthoringPanel({
  projectSlug,
  identifier,
  view,
}: {
  projectSlug: string;
  identifier: string;
  view: WorkspaceView;
}) {
  return <IssueAuthoringPanel projectSlug={projectSlug} identifier={identifier} view={view} compact />;
});

interface IssueAuthoringSessionPanelProps {
  issue: Issue;
  projectSlug: string;
  view: WorkspaceView;
}

export function IssueAuthoringSessionPanel({ issue, projectSlug, view }: IssueAuthoringSessionPanelProps) {
  const { t } = useTranslation();
  const [startSessionOpen, setStartSessionOpen] = useState(false);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t("issue.agentTabs.authoringHint")}</p>
          <IssueWorkingTreeToolbar
            projectSlug={projectSlug}
            issueIdentifier={issue.identifier}
            view={view}
            trailing={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() => setStartSessionOpen(true)}
                title={t("issue.agentTabs.newSessionTitle")}
              >
                <PlayCircle className="h-3.5 w-3.5" />
                {t("issue.agentTabs.newSession")}
              </Button>
            }
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AuthoringPanel projectSlug={projectSlug} identifier={issue.identifier} view={view} />
        </div>
      </div>
      <StartIssueSessionDialog
        projectSlug={projectSlug}
        issue={{
          identifier: issue.identifier,
          title: issue.title,
          agentKind: issue.agentKind ?? null,
        }}
        open={startSessionOpen}
        onOpenChange={setStartSessionOpen}
        view={view}
        navigateToProjectSession
      />
    </>
  );
}
