import { PlayCircle } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import { IssueSessionSplitLayout } from "@/components/sessions/IssueSessionSplitLayout";
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
      <IssueSessionSplitLayout
        projectSlug={projectSlug}
        issueIdentifier={issue.identifier}
        view={view}
        headerStart={<p className="text-xs text-muted-foreground">{t("issue.agentTabs.authoringHint")}</p>}
        toolbarTrailing={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setStartSessionOpen(true)}
            title={t("issue.agentTabs.newSessionTitle")}
          >
            <PlayCircle className="h-3.5 w-3.5" />
            {t("issue.agentTabs.newSession")}
          </Button>
        }
      >
        <AuthoringPanel projectSlug={projectSlug} identifier={issue.identifier} view={view} />
      </IssueSessionSplitLayout>
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
