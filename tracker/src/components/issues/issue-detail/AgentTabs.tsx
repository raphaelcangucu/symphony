import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
}

export function AgentTabs({ issue, projectSlug, execution, view }: AgentTabsProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const section = agentSectionFromSearchParams(new URLSearchParams(location.search));

  const setSection = useCallback(
    (nextSection: AgentSection) => {
      navigate(withAgentSection(location.pathname, location.search, nextSection), { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  return (
    <Tabs
      value={section}
      onValueChange={(value) => {
        if (isAgentSection(value)) setSection(value);
      }}
      className="flex h-full min-h-0 flex-col gap-3"
    >
      <TabsList aria-label="Agent sections" className="w-fit">
        <TabsTrigger value="authoring">Authoring</TabsTrigger>
        <TabsTrigger value="execution">Execution</TabsTrigger>
      </TabsList>

      <TabsContent value="authoring" className="mt-0 min-h-0 flex-1 overflow-hidden">
        <IssueAuthoringPanel projectSlug={projectSlug} identifier={issue.identifier} view={view} compact />
      </TabsContent>
      <TabsContent value="execution" className="mt-0">
        <AgentTab issue={issue} execution={execution} projectSlug={projectSlug} />
      </TabsContent>
    </Tabs>
  );
}
