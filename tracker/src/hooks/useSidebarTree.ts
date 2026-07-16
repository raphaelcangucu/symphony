import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { useRecents } from "@/hooks/useRecents";
import { buildFlatSidebarProject, mergeSessionsFromRecents } from "@/lib/flatSidebarTree";
import {
  TRACKER_PROJECTS_CHANGED_EVENT,
  TRACKER_PROJECT_SESSIONS_CHANGED_EVENT,
} from "@/lib/projectEvents";
import {
  migrateSidebarPreferences,
  readSidebarPreferences,
  type SidebarPreferences,
  writeSidebarPreferences,
} from "@/lib/sidebarPreferences";
import { resolveSidebarRouteSelection } from "@/lib/sidebarRouteResolution";
import { fetchProjectSessions } from "@/hooks/projectSessionsCache";
import { listProjects } from "@/services/projects";
import type { AgentExecution } from "@/types/agent-execution";
import type { Project } from "@/types/project";
import type { ProjectSessionRow } from "@/types/project-session";
import type { SidebarLoadState, SidebarProjectNode } from "@/types/sidebar";

const SIDEBAR_PROJECT_SESSIONS_LIMIT = 20;
const SIDEBAR_PREFERENCES_STORAGE_ERROR =
  "layout.sidebar.errors.preferencesStorage";
const SIDEBAR_PROJECTS_LOAD_ERROR = "layout.sidebar.errors.projectsLoad";

interface SidebarBranchState {
  readonly sessions: readonly ProjectSessionRow[];
  readonly nextCursor: string | null;
  readonly projectActivityAt: string | null;
  readonly inventorySettled: boolean;
  readonly loadState: SidebarLoadState;
  readonly error: string | null;
}

interface BranchResource {
  generation: number;
  active: boolean;
}

export interface UseSidebarTreeResult {
  tree: readonly SidebarProjectNode[];
  projectsLoading: boolean;
  projectsError: string | null;
  projectsErrorDetail: string | null;
  preferences: SidebarPreferences;
  preferencesStorageError: string | null;
  toggleProjectExpanded(slug: string): void;
  toggleWorkspaceExpanded(workspaceId: string): void;
  showAllWorkspaces(projectSlug: string): void;
  showAllSessions(projectSlug: string): void;
  updatePreferences(
    updater: (current: SidebarPreferences) => SidebarPreferences,
  ): void;
  reloadProjects(): Promise<void>;
  reloadProjectBranch(projectSlug: string): Promise<void>;
}

function createBranchState(): SidebarBranchState {
  return {
    sessions: [],
    nextCursor: null,
    projectActivityAt: null,
    inventorySettled: true,
    loadState: "idle",
    error: null,
  };
}

function normalizedId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function timestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function appendSessions(
  previous: readonly ProjectSessionRow[],
  next: readonly ProjectSessionRow[],
): readonly ProjectSessionRow[] {
  const seen = new Set(previous.map(({ id }) => id));
  return [...previous, ...next.filter(({ id }) => !seen.has(id))];
}

function overlayExecutionStatuses(
  sessions: readonly ProjectSessionRow[],
  executions: ReadonlyMap<string, AgentExecution>,
): readonly ProjectSessionRow[] {
  if (sessions.length === 0 || executions.size === 0) return sessions;
  return sessions.map((session) => {
    if (!session.issueIdentifier) return session;
    const execution = executions.get(session.issueIdentifier);
    return execution ? { ...session, aggregateStatus: execution.status } : session;
  });
}

function errorDetail(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "unknown error";
}

export function useSidebarTree(): UseSidebarTreeResult {
  const location = useLocation();
  const { executions } = useAgentExecutions();
  const { sessions: recents } = useRecents();
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const projectsRef = useRef<readonly Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsErrorDetail, setProjectsErrorDetail] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<SidebarPreferences>(() =>
    readSidebarPreferences(),
  );
  const preferencesRef = useRef(preferences);
  const [preferencesStorageError, setPreferencesStorageError] = useState<string | null>(null);
  const [branchStates, setBranchStates] = useState<ReadonlyMap<string, SidebarBranchState>>(
    () => new Map(),
  );
  const branchStatesRef = useRef<ReadonlyMap<string, SidebarBranchState>>(new Map());
  const branchResourcesRef = useRef(new Map<string, BranchResource>());
  const mountedRef = useRef(false);
  const projectsGenerationRef = useRef(0);

  const updateBranchState = useCallback(
    (
      projectSlug: string,
      updater: (current: SidebarBranchState) => SidebarBranchState,
    ) => {
      if (!mountedRef.current) return;
      const currentStates = branchStatesRef.current;
      const current = currentStates.get(projectSlug) ?? createBranchState();
      const next = updater(current);
      if (next === current) return;
      const nextStates = new Map(currentStates);
      nextStates.set(projectSlug, next);
      branchStatesRef.current = nextStates;
      setBranchStates(nextStates);
    },
    [],
  );

  const branchResource = useCallback((projectSlug: string): BranchResource => {
    const existing = branchResourcesRef.current.get(projectSlug);
    if (existing) return existing;
    const created = { generation: 0, active: false };
    branchResourcesRef.current.set(projectSlug, created);
    return created;
  }, []);

  const updatePreferences = useCallback(
    (updater: (current: SidebarPreferences) => SidebarPreferences) => {
      if (typeof updater !== "function") {
        throw new TypeError("Sidebar preferences updater must be a function");
      }
      const next = migrateSidebarPreferences(updater(preferencesRef.current));
      preferencesRef.current = next;
      setPreferencesStorageError(
        writeSidebarPreferences(next) ? null : SIDEBAR_PREFERENCES_STORAGE_ERROR,
      );
      setPreferences(next);
    },
    [],
  );

  const closeBranch = useCallback((projectSlug: string) => {
    const resource = branchResourcesRef.current.get(projectSlug);
    if (!resource) return;
    resource.generation += 1;
    resource.active = false;
  }, []);

  const startBranchLoad = useCallback(
    async (projectSlug: string, cursor: string | null = null): Promise<void> => {
      if (!mountedRef.current) return;
      if (!projectsRef.current.some((project) => project.slug === projectSlug)) return;

      const resource = branchResource(projectSlug);
      const generation = ++resource.generation;
      resource.active = true;
      const append = cursor !== null;
      updateBranchState(projectSlug, (current) => ({
        ...current,
        inventorySettled: true,
        loadState: "loading",
        error: null,
      }));

      try {
        const page = await fetchProjectSessions({
          projectSlug,
          limit: SIDEBAR_PROJECT_SESSIONS_LIMIT,
          ...(cursor ? { cursor } : {}),
          includeArchived: preferencesRef.current.filters.showArchived,
        });
        if (
          !mountedRef.current ||
          !resource.active ||
          resource.generation !== generation
        ) {
          return;
        }
        updateBranchState(projectSlug, (current) => ({
          sessions: append ? appendSessions(current.sessions, page.sessions) : [...page.sessions],
          nextCursor: page.nextCursor,
          projectActivityAt: page.projectActivityAt,
          inventorySettled: true,
          loadState: "ready",
          error: null,
        }));
      } catch (error) {
        if (
          !mountedRef.current ||
          !resource.active ||
          resource.generation !== generation
        ) {
          return;
        }
        updateBranchState(projectSlug, (current) => ({
          ...current,
          inventorySettled: true,
          loadState: current.sessions.length > 0 ? "stale" : "error",
          error: errorDetail(error),
        }));
      }
    },
    [branchResource, updateBranchState],
  );

  const reloadProjectBranch = useCallback(
    async (projectSlug: string) => {
      const slug = normalizedId(projectSlug);
      if (!slug) return;
      await startBranchLoad(slug);
    },
    [startBranchLoad],
  );

  const reloadProjects = useCallback(async () => {
    const generation = ++projectsGenerationRef.current;
    if (mountedRef.current) {
      setProjectsLoading(true);
      setProjectsError(null);
      setProjectsErrorDetail(null);
    }
    try {
      const nextProjects = await listProjects({ includeArchived: true });
      if (!mountedRef.current || generation !== projectsGenerationRef.current) return;
      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      setProjectsLoading(false);
    } catch (error) {
      if (!mountedRef.current || generation !== projectsGenerationRef.current) return;
      setProjectsLoading(false);
      setProjectsError(SIDEBAR_PROJECTS_LOAD_ERROR);
      setProjectsErrorDetail(errorDetail(error));
    }
  }, []);

  const toggleProjectExpanded = useCallback(
    (projectSlug: string) => {
      const slug = normalizedId(projectSlug);
      if (!slug || !projectsRef.current.some((project) => project.slug === slug)) return;
      if (preferencesRef.current.expandedProjectIds.includes(slug)) closeBranch(slug);
      updatePreferences((current) => ({
        ...current,
        expandedProjectIds: current.expandedProjectIds.includes(slug)
          ? current.expandedProjectIds.filter((id) => id !== slug)
          : [...current.expandedProjectIds, slug],
      }));
    },
    [closeBranch, updatePreferences],
  );

  const toggleWorkspaceExpanded = useCallback(
    (workspaceId: string) => {
      const id = normalizedId(workspaceId);
      if (!id) return;
      updatePreferences((current) => ({
        ...current,
        expandedWorkspaceIds: current.expandedWorkspaceIds.includes(id)
          ? current.expandedWorkspaceIds.filter((value) => value !== id)
          : [...current.expandedWorkspaceIds, id],
      }));
    },
    [updatePreferences],
  );

  const showAllWorkspaces = useCallback(() => undefined, []);

  const showAllSessions = useCallback(
    (projectSlug: string) => {
      const branch = branchStatesRef.current.get(projectSlug);
      if (!branch?.nextCursor || branch.loadState === "loading") return;
      void startBranchLoad(projectSlug, branch.nextCursor);
    },
    [startBranchLoad],
  );

  useEffect(() => {
    mountedRef.current = true;
    void reloadProjects();
    const onProjectsChanged = () => void reloadProjects();
    const onProjectSessionsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ projectSlug?: unknown }>).detail;
      const slug =
        typeof detail?.projectSlug === "string" ? detail.projectSlug.trim() : "";
      if (!slug) return;
      if (!preferencesRef.current.expandedProjectIds.includes(slug)) {
        updatePreferences((current) =>
          current.expandedProjectIds.includes(slug)
            ? current
            : { ...current, expandedProjectIds: [...current.expandedProjectIds, slug] },
        );
      }
      void reloadProjectBranch(slug);
    };
    window.addEventListener(TRACKER_PROJECTS_CHANGED_EVENT, onProjectsChanged);
    window.addEventListener(TRACKER_PROJECT_SESSIONS_CHANGED_EVENT, onProjectSessionsChanged);
    return () => {
      mountedRef.current = false;
      window.removeEventListener(TRACKER_PROJECTS_CHANGED_EVENT, onProjectsChanged);
      window.removeEventListener(
        TRACKER_PROJECT_SESSIONS_CHANGED_EVENT,
        onProjectSessionsChanged,
      );
      for (const [slug] of branchResourcesRef.current) closeBranch(slug);
    };
  }, [closeBranch, reloadProjectBranch, reloadProjects, updatePreferences]);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    const expanded = new Set(preferences.expandedProjectIds);
    for (const [slug, resource] of branchResourcesRef.current) {
      if (!expanded.has(slug) && resource.active) closeBranch(slug);
    }
    for (const slug of expanded) {
      if (projects.some((project) => project.slug === slug)) void startBranchLoad(slug);
    }
  }, [closeBranch, preferences.expandedProjectIds, projects, startBranchLoad]);

  const routeSelection = useMemo(
    () => resolveSidebarRouteSelection(location.pathname, location.search),
    [location.pathname, location.search],
  );

  useEffect(() => {
    const slug = routeSelection.projectSlug;
    if (!slug || !projects.some((project) => project.slug === slug)) return;
    if (preferencesRef.current.expandedProjectIds.includes(slug)) return;
    updatePreferences((current) => ({
      ...current,
      expandedProjectIds: [...current.expandedProjectIds, slug],
    }));
  }, [projects, routeSelection.projectSlug, updatePreferences]);

  const tree = useMemo(() => {
    const options = {
      pinnedProjectIds: new Set(preferences.pinnedProjectIds),
      pinnedWorkspaceIds: new Set(preferences.pinnedWorkspaceIds),
      pinnedSessionIds: new Set(preferences.pinnedSessionIds),
      lastReadAtBySession: preferences.lastReadAtBySession,
      sortMode: preferences.sort,
      groupMode: preferences.group,
      filters: preferences.filters,
    };
    const visible = preferences.filters.showArchived
      ? projects
      : projects.filter((project) => project.archivedAt == null);
    return visible
      .map((project) => {
        const branch = branchStates.get(project.slug) ?? createBranchState();
        const projectRecents = recents.filter((recent) => recent.projectSlug === project.slug);
        const sessions = mergeSessionsFromRecents(
          overlayExecutionStatuses(branch.sessions, executions),
          projectRecents,
          project.slug,
        );
        return buildFlatSidebarProject({
          projectSlug: project.slug,
          projectTitle: project.name,
          archived: project.archivedAt != null,
          sessions,
          nextCursor: branch.nextCursor,
          loadState: branch.loadState,
          error: branch.error,
          options,
        });
      })
      .sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
        const leftProject = visible.find((project) => project.slug === left.projectSlug);
        const rightProject = visible.find((project) => project.slug === right.projectSlug);
        const leftActivity = branchStates.get(left.id)?.projectActivityAt
          ?? leftProject?.lastActivityAt
          ?? leftProject?.updatedAt
          ?? left.updatedAt;
        const rightActivity = branchStates.get(right.id)?.projectActivityAt
          ?? rightProject?.lastActivityAt
          ?? rightProject?.updatedAt
          ?? right.updatedAt;
        return timestamp(rightActivity) - timestamp(leftActivity) || left.title.localeCompare(right.title);
      });
  }, [branchStates, executions, preferences, projects, recents]);

  return {
    tree,
    projectsLoading,
    projectsError,
    projectsErrorDetail,
    preferences,
    preferencesStorageError,
    toggleProjectExpanded,
    toggleWorkspaceExpanded,
    showAllWorkspaces,
    showAllSessions,
    updatePreferences,
    reloadProjects,
    reloadProjectBranch,
  };
}
