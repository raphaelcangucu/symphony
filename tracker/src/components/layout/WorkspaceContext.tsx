import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { useCollapsedColumns } from "@/hooks/useCollapsedColumns";
import { useIssueBoard, type UseIssueBoardResult } from "@/hooks/useIssueBoard";
import { filtersFromSearchParams } from "@/lib/issueFilters";
import { viewFromPathname, type WorkspaceView } from "@/lib/workspaceRoutes";
import { getProject } from "@/services/projects";
import type { AgentExecution } from "@/types/agent-execution";
import type { Project, TrackerKind } from "@/types/project";
import type { WorkflowStatus, WorkflowStatusName } from "@/types/workflow-status";

interface WorkspaceContextValue extends UseIssueBoardResult {
  projectSlug: string;
  view: WorkspaceView;
  project: Project | null;
  trackerKind: TrackerKind;
  statusNames: WorkflowStatusName[] | undefined;
  workflowStatuses: WorkflowStatus[] | undefined;
  agentExecutions: ReadonlyMap<string, AgentExecution>;
  knownLogins: string[];
  collapsed: ReadonlySet<string>;
  toggleCollapse: (status: WorkflowStatusName) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

interface WorkspaceProviderProps {
  children: ReactNode;
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const { projectSlug = "" } = useParams();
  const location = useLocation();
  const view = viewFromPathname(location.pathname);
  const [searchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);

  const [project, setProject] = useState<Project | null>(null);
  const statusNames = useMemo(
    () => project?.workflowStatuses?.map((status) => status.name),
    [project],
  );

  const board = useIssueBoard(projectSlug, filters, statusNames);
  const { executions: agentExecutions } = useAgentExecutions({ enabled: projectSlug.trim() !== "" });
  const { collapsed, toggle: toggleCollapse } = useCollapsedColumns(projectSlug);

  const trackerKind = project?.tracker?.kind ?? "local";

  const knownLogins = useMemo(() => {
    const logins = new Set<string>();
    for (const issue of board.issues) {
      if (issue.assignee) logins.add(issue.assignee);
      if (issue.creator) logins.add(issue.creator);
    }
    return Array.from(logins);
  }, [board.issues]);

  useEffect(() => {
    if (!projectSlug.trim()) {
      setProject(null);
      return;
    }
    let active = true;
    void getProject(projectSlug)
      .then((loaded) => {
        if (active) setProject(loaded);
      })
      .catch(() => {
        if (active) setProject(null);
      });
    return () => {
      active = false;
    };
  }, [projectSlug]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      ...board,
      projectSlug,
      view,
      project,
      trackerKind,
      statusNames,
      workflowStatuses: project?.workflowStatuses,
      agentExecutions,
      knownLogins,
      collapsed,
      toggleCollapse,
    }),
    [board, projectSlug, view, project, trackerKind, statusNames, agentExecutions, knownLogins, collapsed, toggleCollapse],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return ctx;
}
