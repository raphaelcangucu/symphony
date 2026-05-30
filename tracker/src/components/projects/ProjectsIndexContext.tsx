import { createContext, useContext } from "react";

import type { Project } from "@/types/project";

export type ProjectStatusFilter = "ongoing" | "archived" | "all";

export interface ProjectsIndexContextValue {
  projects: Project[];
  statusFilter: ProjectStatusFilter;
  setStatusFilter: (filter: ProjectStatusFilter) => void;
  keyword: string;
  setKeyword: (keyword: string) => void;
  ongoingCount: number;
  archivedCount: number;
  hasActiveFilters: boolean;
  clearFilters: () => void;
  onProjectCreated: (project: Project) => void;
}

const ProjectsIndexContext = createContext<ProjectsIndexContextValue | null>(null);

export const ProjectsIndexProvider = ProjectsIndexContext.Provider;

export function useProjectsIndex(): ProjectsIndexContextValue {
  const ctx = useContext(ProjectsIndexContext);
  if (!ctx) throw new Error("useProjectsIndex must be used inside the projects index page");
  return ctx;
}
