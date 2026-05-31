import { useState } from "react";

import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WorkspaceView } from "@/lib/workspaceRoutes";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

import { AgentTab } from "./AgentTab";

const AGENT_SECTIONS = ["authoring", "execution"] as const;

type AgentSection = (typeof AGENT_SECTIONS)[number];

interface AgentTabsProps {
  issue: Issue;
  projectSlug: string;
  execution?: AgentExecution;
  view: WorkspaceView;
}

function isAgentSection(value: string): value is AgentSection {
  return (AGENT_SECTIONS as readonly string[]).includes(value);
}

export function AgentTabs({ issue, projectSlug, execution, view }: AgentTabsProps) {
  const [section, setSection] = useState<AgentSection>("authoring");

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
        <AgentTab issue={issue} execution={execution} />
      </TabsContent>
    </Tabs>
  );
}
