import { PenLine, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { composerSeedFromHandoff, consumePreviewAssistantHandoff } from "@/lib/previewAssistantHandoff";
import {
  agentSectionFromSearchParams,
  type AgentSection,
  isAgentSection,
  withAgentSection,
  type WorkspaceView,
} from "@/lib/workspaceRoutes";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

import { AgentTab } from "./AgentTab";

interface AgentTabsProps {
  issue: Issue;
  projectSlug: string;
  execution?: AgentExecution;
  view: WorkspaceView;
  onIssueUpdated?: (updated: Issue) => void;
}

export function AgentTabs({ issue, projectSlug, execution, view, onIssueUpdated }: AgentTabsProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const section = agentSectionFromSearchParams(new URLSearchParams(location.search));
  const [steerSeedMessage, setSteerSeedMessage] = useState<string | null>(null);

  const setSection = useCallback(
    (nextSection: AgentSection) => {
      navigate(withAgentSection(location.pathname, location.search, nextSection), { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  useEffect(() => {
    const handoff = consumePreviewAssistantHandoff(projectSlug, issue.identifier);
    if (!handoff || handoff.target !== "execution-steer") return;

    setSteerSeedMessage(composerSeedFromHandoff(handoff));
    setSection("execution");
  }, [issue.identifier, projectSlug, setSection]);

  return (
    <Tabs
      value={section}
      onValueChange={(value) => {
        if (isAgentSection(value)) setSection(value);
      }}
      className="flex h-full min-h-0 flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {section === "authoring"
            ? "Shape the brief and plan before dispatching the agent."
            : "Live execution status, session log, and steering."}
        </p>
        <TabsList
          aria-label="Agent sections"
          className="h-8 shrink-0 gap-0.5 rounded-lg border border-border/60 bg-muted/60 p-0.5"
        >
          <TabsTrigger
            value="authoring"
            className="gap-1.5 rounded-md px-2.5 text-xs data-[state=active]:shadow-sm"
          >
            <PenLine className="h-3.5 w-3.5" />
            Authoring
          </TabsTrigger>
          <TabsTrigger
            value="execution"
            className="gap-1.5 rounded-md px-2.5 text-xs data-[state=active]:shadow-sm"
          >
            <Play className="h-3.5 w-3.5" />
            Execution
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="authoring" className="mt-0 min-h-0 flex-1 overflow-hidden">
        <IssueAuthoringPanel projectSlug={projectSlug} identifier={issue.identifier} view={view} execution={execution} compact />
      </TabsContent>
      <TabsContent value="execution" className="mt-0">
        <AgentTab
          issue={issue}
          execution={execution}
          projectSlug={projectSlug}
          steerSeedMessage={steerSeedMessage}
          onIssueUpdated={onIssueUpdated}
        />
      </TabsContent>
    </Tabs>
  );
}
