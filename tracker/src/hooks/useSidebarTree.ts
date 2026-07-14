import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { TRACKER_PROJECTS_CHANGED_EVENT } from "@/lib/projectEvents";
import {
  migrateSidebarPreferences,
  readSidebarPreferences,
  type SidebarPreferences,
  writeSidebarPreferences,
} from "@/lib/sidebarPreferences";
import {
  ancestorIdsForSelection,
  resolveSidebarRouteSelection,
} from "@/lib/sidebarRouteResolution";
import { buildSidebarProjectTree } from "@/lib/sidebarTree";
import { listAssistantThreads } from "@/services/assistantThreads";
import { listIssues } from "@/services/issues";
import { listProjects } from "@/services/projects";
import { listRecents } from "@/services/recents";
import {
  fetchWorkspaceInventory,
  subscribeWorkspaceInventory,
} from "@/services/worktrees";
import type { AssistantThread } from "@/types/assistant-thread";
import type { Issue } from "@/types/issue";
import type { Project } from "@/types/project";
import type { RecentSession } from "@/types/recents";
import type { SidebarLoadState, SidebarProjectNode } from "@/types/sidebar";
import type {
  WorkspaceInventoryEntry,
  WorkspaceInventoryTotals,
} from "@/types/worktrees";

const BRANCH_RECENT_LIMIT = 100;
const BRANCH_THREAD_LIMIT = 100;
export const SIDEBAR_INVENTORY_COMPLETION_TIMEOUT_MS = 15_000;
export const SIDEBAR_CORE_SOURCE_TIMEOUT_MS = 20_000;
export const SIDEBAR_HTTP_REQUEST_TIMEOUT_MS = 20_000;
const SIDEBAR_PREFERENCES_STORAGE_ERROR =
  "layout.sidebar.errors.preferencesStorage";
const SIDEBAR_PROJECTS_LOAD_ERROR = "layout.sidebar.errors.projectsLoad";
const UNLIMITED_SIDEBAR_NODES = Number.MAX_SAFE_INTEGER;
const ASSISTANT_THREAD_SCOPES = [
  "project_session",
  "project_explore",
  "issue",
  "issue_session",
] as const;
const EMPTY_TOTALS: WorkspaceInventoryTotals = {
  count: 0,
  sizeBytes: 0,
  reclaimableBytes: 0,
};

interface SidebarBranchState {
  hasSnapshot: boolean;
  coreSettled: boolean;
  inventorySettled: boolean;
  issues: readonly Issue[];
  relatedSessions: readonly RecentSession[];
  assistantThreads: readonly AssistantThread[];
  completedInventoryByPath: ReadonlyMap<string, WorkspaceInventoryEntry>;
  draftInventoryByPath: ReadonlyMap<string, WorkspaceInventoryEntry> | null;
  completedTotals: Readonly<WorkspaceInventoryTotals>;
  draftTotals: Readonly<WorkspaceInventoryTotals> | null;
  loadState: SidebarLoadState;
  error: string | null;
  sourceErrors: Readonly<Partial<Record<BranchErrorSource, string>>>;
}

type BranchErrorSource = "issues" | "recents" | "threads" | "inventory";

interface SidebarBranchResource {
  generation: number;
  active: boolean;
  fallbackStarted: boolean;
  unsubscribe: (() => void) | null;
  completionTimeout: ReturnType<typeof setTimeout> | null;
  settleInventory: (() => void) | null;
  coreTimeouts: Set<ReturnType<typeof setTimeout>>;
  cancelCore: (() => void) | null;
  cancelFallback: (() => void) | null;
}

interface SidebarProjectNodeCacheEntry {
  project: Project;
  branch: SidebarBranchState | undefined;
  preferences: SidebarPreferences;
  executions: ReturnType<typeof useAgentExecutions>["executions"];
  node: SidebarProjectNode;
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
  showAllSessions(workspaceId: string): void;
  updatePreferences(
    updater: (current: SidebarPreferences) => SidebarPreferences,
  ): void;
  reloadProjects(): Promise<void>;
  reloadProjectBranch(projectSlug: string): Promise<void>;
}

function createBranchState(): SidebarBranchState {
  return {
    hasSnapshot: false,
    coreSettled: false,
    inventorySettled: false,
    issues: [],
    relatedSessions: [],
    assistantThreads: [],
    completedInventoryByPath: new Map(),
    draftInventoryByPath: null,
    completedTotals: EMPTY_TOTALS,
    draftTotals: null,
    loadState: "idle",
    error: null,
    sourceErrors: {},
  };
}

function createBranchResource(): SidebarBranchResource {
  return {
    generation: 0,
    active: false,
    fallbackStarted: false,
    unsubscribe: null,
    completionTimeout: null,
    settleInventory: null,
    coreTimeouts: new Set(),
    cancelCore: null,
    cancelFallback: null,
  };
}

function normalizedId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function clonePreferences(preferences: SidebarPreferences): SidebarPreferences {
  return {
    ...preferences,
    expandedProjectIds: [...preferences.expandedProjectIds],
    expandedWorkspaceIds: [...preferences.expandedWorkspaceIds],
    pinnedProjectIds: [...preferences.pinnedProjectIds],
    pinnedWorkspaceIds: [...preferences.pinnedWorkspaceIds],
    pinnedSessionIds: [...preferences.pinnedSessionIds],
    filters: {
      ...preferences.filters,
      statuses: [...preferences.filters.statuses],
      agents: [...preferences.filters.agents],
    },
    lastReadAtBySession: { ...preferences.lastReadAtBySession },
    revealedProjectIds: [...preferences.revealedProjectIds],
    revealedWorkspaceIds: [...preferences.revealedWorkspaceIds],
  };
}

function toggledId(values: readonly string[], id: string): string[] {
  return values.includes(id)
    ? values.filter((candidate) => candidate !== id)
    : [...values, id];
}

function addedId(values: readonly string[], id: string): string[] {
  return values.includes(id) ? [...values] : [...values, id];
}

function errorDetail(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message.trim()
    : "unknown error";
}

function combinedSourceError(
  projectSlug: string,
  errors: Readonly<Partial<Record<BranchErrorSource, string>>>,
): string | null {
  const labels: Readonly<Record<BranchErrorSource, string>> = {
    issues: "issues",
    recents: "recents",
    threads: "assistant threads",
    inventory: "workspace inventory",
  };
  const parts = (["issues", "recents", "threads", "inventory"] as const)
    .filter((source) => errors[source])
    .map((source) => `${labels[source]}: ${errors[source]}`);
  return parts.length === 0
    ? null
    : `Could not fully load project "${projectSlug}" (${parts.join("; ")}). Retry the project branch.`;
}

function safelyInvoke(cleanup: (() => void) | null): void {
  if (!cleanup) return;
  try {
    cleanup();
  } catch {
    // Cleanup is best-effort; generations still invalidate late callbacks.
  }
}

function logicalRequest<T>(
  underlying: Promise<T>,
  timeoutMessage: string,
): { promise: Promise<T>; cancel: () => void } {
  let settleRejected!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(timeoutMessage));
    }, SIDEBAR_HTTP_REQUEST_TIMEOUT_MS);
    const finishResolved = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    settleRejected = (reason: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(reason);
    };
    underlying.then(finishResolved, settleRejected);
  });
  return {
    promise,
    cancel: () => settleRejected(new Error("request cancelled")),
  };
}

function isCurrentGeneration(
  mounted: boolean,
  resource: SidebarBranchResource,
  generation: number,
): boolean {
  return mounted && resource.active && resource.generation === generation;
}

export function useSidebarTree(): UseSidebarTreeResult {
  const location = useLocation();
  const { executions } = useAgentExecutions();
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const projectsRef = useRef<readonly Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsErrorDetail, setProjectsErrorDetail] = useState<string | null>(
    null,
  );
  const [preferences, setPreferences] = useState<SidebarPreferences>(() =>
    readSidebarPreferences(),
  );
  const [preferencesStorageError, setPreferencesStorageError] = useState<
    string | null
  >(null);
  const preferencesRef = useRef(preferences);
  const [branchStates, setBranchStates] = useState<
    ReadonlyMap<string, SidebarBranchState>
  >(() => new Map());
  const branchStatesRef = useRef<ReadonlyMap<string, SidebarBranchState>>(
    new Map(),
  );
  const branchResourcesRef = useRef(new Map<string, SidebarBranchResource>());
  const projectNodeCacheRef = useRef(
    new Map<string, SidebarProjectNodeCacheEntry>(),
  );
  const sharedRecentsRef = useRef<{
    inFlight: Promise<readonly RecentSession[]> | null;
  }>({ inFlight: null });
  const rootGenerationRef = useRef(0);
  const cancelRootRequestRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(false);
  const previousShowArchivedRef = useRef(preferences.filters.showArchived);

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

  const branchResource = useCallback((projectSlug: string) => {
    const existing = branchResourcesRef.current.get(projectSlug);
    if (existing) return existing;
    const created = createBranchResource();
    branchResourcesRef.current.set(projectSlug, created);
    return created;
  }, []);

  const sharedRecents = useCallback((): Promise<readonly RecentSession[]> => {
    const current = sharedRecentsRef.current;
    if (current.inFlight) return current.inFlight;
    const promise = listRecents(BRANCH_RECENT_LIMIT)
      .then((items) => [...items])
      .finally(() => {
        if (sharedRecentsRef.current.inFlight === promise) {
          sharedRecentsRef.current.inFlight = null;
        }
      });
    sharedRecentsRef.current.inFlight = promise;
    return promise;
  }, []);

  const updatePreferences = useCallback(
    (updater: (current: SidebarPreferences) => SidebarPreferences) => {
      if (typeof updater !== "function") {
        throw new TypeError("Sidebar preferences updater must be a function");
      }
      const next = migrateSidebarPreferences(
        updater(clonePreferences(preferencesRef.current)),
      );
      preferencesRef.current = next;
      const persisted = writeSidebarPreferences(next);
      setPreferencesStorageError(
        persisted ? null : SIDEBAR_PREFERENCES_STORAGE_ERROR,
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
    const unsubscribe = resource.unsubscribe;
    resource.unsubscribe = null;
    if (resource.completionTimeout) clearTimeout(resource.completionTimeout);
    resource.completionTimeout = null;
    const settleInventory = resource.settleInventory;
    resource.settleInventory = null;
    const cancelCore = resource.cancelCore;
    resource.cancelCore = null;
    const cancelFallback = resource.cancelFallback;
    resource.cancelFallback = null;
    try {
      safelyInvoke(unsubscribe);
    } finally {
      try {
        safelyInvoke(settleInventory);
      } finally {
        try {
          safelyInvoke(cancelCore);
        } finally {
          safelyInvoke(cancelFallback);
        }
      }
    }
    updateBranchState(projectSlug, (current) =>
      current.draftInventoryByPath || current.draftTotals
        ? {
            ...current,
            draftInventoryByPath: null,
            draftTotals: null,
          }
        : current,
    );
  }, [updateBranchState]);

  const startBranchLoad = useCallback(
    async (projectSlug: string): Promise<void> => {
      const project = projectsRef.current.find((candidate) => candidate.slug === projectSlug);
      if (!project || !mountedRef.current) return;

      const cachedBranch =
        branchStatesRef.current.get(projectSlug) ?? createBranchState();
      const hadSnapshotBeforeLoad = cachedBranch.hasSnapshot;
      const resource = branchResource(projectSlug);
      safelyInvoke(resource.unsubscribe);
      if (resource.completionTimeout) clearTimeout(resource.completionTimeout);
      safelyInvoke(resource.settleInventory);
      safelyInvoke(resource.cancelCore);
      safelyInvoke(resource.cancelFallback);
      resource.generation += 1;
      const generation = resource.generation;
      resource.active = true;
      resource.fallbackStarted = false;
      resource.unsubscribe = null;
      resource.completionTimeout = null;
      resource.cancelCore = null;
      resource.cancelFallback = null;
      let resolveInventory!: () => void;
      const inventoryCompletion = new Promise<void>((resolve) => {
        resolveInventory = resolve;
      });
      let inventoryCompleted = false;
      const completeInventory = () => {
        if (inventoryCompleted) return;
        inventoryCompleted = true;
        if (resource.completionTimeout) clearTimeout(resource.completionTimeout);
        resource.completionTimeout = null;
        resource.settleInventory = null;
        resolveInventory();
      };
      resource.settleInventory = completeInventory;
      updateBranchState(projectSlug, (current) => ({
        ...current,
        coreSettled: false,
        inventorySettled: false,
        draftInventoryByPath: null,
        draftTotals: null,
        loadState: current.hasSnapshot ? "stale" : "loading",
        error: null,
        sourceErrors: {},
      }));

      const generationIsCurrent = () =>
        isCurrentGeneration(mountedRef.current, resource, generation);
      const settleIfComplete = (next: SidebarBranchState): SidebarBranchState => {
        if (!next.coreSettled || !next.inventorySettled) return next;
        const error = combinedSourceError(projectSlug, next.sourceErrors);
        return {
          ...next,
          hasSnapshot: error ? hadSnapshotBeforeLoad : true,
          error,
          loadState: error
            ? hadSnapshotBeforeLoad
              ? "stale"
              : "error"
            : "ready",
        };
      };
      const failInventory = (error: unknown) => {
        if (generationIsCurrent()) {
          updateBranchState(projectSlug, (current) => {
            const sourceErrors = {
              ...current.sourceErrors,
              inventory: errorDetail(error),
            };
            const next = {
              ...current,
              completedInventoryByPath: hadSnapshotBeforeLoad
                ? new Map(cachedBranch.completedInventoryByPath)
                : current.completedInventoryByPath,
              draftInventoryByPath: hadSnapshotBeforeLoad
                ? null
                : current.draftInventoryByPath,
              completedTotals: hadSnapshotBeforeLoad
                ? { ...cachedBranch.completedTotals }
                : current.completedTotals,
              draftTotals: null,
              inventorySettled: true,
              sourceErrors,
              error: combinedSourceError(projectSlug, sourceErrors),
              loadState: hadSnapshotBeforeLoad ? "stale" as const : "error" as const,
            };
            return settleIfComplete(next);
          });
        }
        completeInventory();
      };
      const startInventoryFallback = () => {
        if (!generationIsCurrent() || resource.fallbackStarted) return;
        resource.fallbackStarted = true;
        if (resource.completionTimeout) clearTimeout(resource.completionTimeout);
        resource.completionTimeout = null;
        const unsubscribe = resource.unsubscribe;
        resource.unsubscribe = null;
        safelyInvoke(unsubscribe);
        // The inventory service has no AbortSignal parameter; generation guards
        // make late HTTP completion inert after collapse, reload, or unmount.
        const fallbackRequest = logicalRequest(
          fetchWorkspaceInventory(projectSlug),
          `workspace inventory timed out after ${SIDEBAR_HTTP_REQUEST_TIMEOUT_MS}ms`,
        );
        resource.cancelFallback = fallbackRequest.cancel;
        void fallbackRequest.promise
          .then((snapshot) => {
            if (resource.generation === generation) {
              resource.cancelFallback = null;
            }
            if (generationIsCurrent()) {
              updateBranchState(projectSlug, (current) =>
                settleIfComplete({
                  ...current,
                  completedInventoryByPath: new Map(
                    snapshot.entries.map((entry) => [entry.path, entry]),
                  ),
                  draftInventoryByPath: null,
                  completedTotals: { ...snapshot.totals },
                  draftTotals: null,
                  inventorySettled: true,
                }),
              );
            }
            completeInventory();
          })
          .catch((error) => {
            if (resource.generation === generation) {
              resource.cancelFallback = null;
            }
            failInventory(error);
          });
      };

      let scanEntries: ReadonlyMap<string, WorkspaceInventoryEntry> = new Map();
      resource.completionTimeout = setTimeout(
        startInventoryFallback,
        SIDEBAR_INVENTORY_COMPLETION_TIMEOUT_MS,
      );
      try {
        const unsubscribe = subscribeWorkspaceInventory(projectSlug, {
          onEntry: (entry) => {
            if (!generationIsCurrent() || resource.fallbackStarted) return;
            const nextScanEntries = new Map(scanEntries);
            nextScanEntries.set(entry.path, entry);
            scanEntries = nextScanEntries;
            updateBranchState(projectSlug, (current) => ({
              ...current,
              draftInventoryByPath: new Map(scanEntries),
            }));
          },
          onTotals: (totals) => {
            if (!generationIsCurrent() || resource.fallbackStarted) return;
            updateBranchState(projectSlug, (current) => ({
              ...current,
              draftTotals: { ...totals },
            }));
          },
          onDone: () => {
            if (!generationIsCurrent() || resource.fallbackStarted) return;
            updateBranchState(projectSlug, (current) =>
              settleIfComplete({
                ...current,
                completedInventoryByPath: new Map(scanEntries),
                draftInventoryByPath: null,
                completedTotals:
                  current.draftTotals ?? current.completedTotals,
                draftTotals: null,
                inventorySettled: true,
              }),
            );
            completeInventory();
          },
          onError: startInventoryFallback,
        });
        if (generationIsCurrent() && !resource.fallbackStarted) {
          resource.unsubscribe = unsubscribe;
        } else {
          safelyInvoke(unsubscribe);
        }
      } catch {
        startInventoryFallback();
      }

      const coreCancellations = new Set<() => void>();
      const logicalSource = <T,>(
        source: BranchErrorSource,
        sourcePromise: Promise<T>,
        onTimeout?: () => void,
      ): Promise<T> =>
        new Promise<T>((resolve, reject) => {
          let settled = false;
          let timeout!: ReturnType<typeof setTimeout>;
          let cancel!: () => void;
          const cleanup = () => {
            clearTimeout(timeout);
            resource.coreTimeouts.delete(timeout);
            coreCancellations.delete(cancel);
          };
          const settleResolved = (value: T) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
          };
          const settleRejected = (reason: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(reason);
          };
          timeout = setTimeout(() => {
            onTimeout?.();
            settleRejected(
              new Error(
                `${source} timed out after ${SIDEBAR_CORE_SOURCE_TIMEOUT_MS}ms`,
              ),
            );
          }, SIDEBAR_CORE_SOURCE_TIMEOUT_MS);
          cancel = () => settleRejected(new Error(`${source} cancelled`));
          resource.coreTimeouts.add(timeout);
          coreCancellations.add(cancel);
          sourcePromise.then(settleResolved, settleRejected);
        });
      resource.cancelCore = () => {
        for (const cancel of [...coreCancellations]) safelyInvoke(cancel);
        for (const timeout of resource.coreTimeouts) clearTimeout(timeout);
        resource.coreTimeouts.clear();
      };
      const recentsPromise = sharedRecents();
      const coreCompletion = Promise.allSettled([
          logicalSource("issues", listIssues(projectSlug)),
          logicalSource("recents", recentsPromise, () => {
            if (sharedRecentsRef.current.inFlight === recentsPromise) {
              sharedRecentsRef.current.inFlight = null;
            }
          }),
          logicalSource("threads", listAssistantThreads({
            projectSlug,
            scopes: [...ASSISTANT_THREAD_SCOPES],
            limit: BRANCH_THREAD_LIMIT,
            includeArchived: preferencesRef.current.filters.showArchived,
          })),
        ] as const).then((results) => {
        if (resource.generation === generation) {
          resource.cancelCore = null;
          for (const timeout of resource.coreTimeouts) clearTimeout(timeout);
          resource.coreTimeouts.clear();
        }
        if (!generationIsCurrent()) return;
        updateBranchState(projectSlug, (current) => {
          const [issuesResult, recentsResult, threadsResult] = results;
          const sourceErrors = { ...current.sourceErrors };
          if (issuesResult.status === "rejected") {
            sourceErrors.issues = errorDetail(issuesResult.reason);
          }
          if (recentsResult.status === "rejected") {
            sourceErrors.recents = errorDetail(recentsResult.reason);
          }
          if (threadsResult.status === "rejected") {
            sourceErrors.threads = errorDetail(threadsResult.reason);
          }
          return settleIfComplete({
            ...current,
            issues:
              issuesResult.status === "fulfilled"
                ? [...issuesResult.value]
                : current.issues,
            relatedSessions:
              recentsResult.status === "fulfilled"
                ? recentsResult.value.filter(
                    (recent) =>
                      recent.projectSlug === projectSlug &&
                      recent.scope !== "freeform",
                  )
                : current.relatedSessions,
            assistantThreads:
              threadsResult.status === "fulfilled"
                ? [...threadsResult.value]
                : current.assistantThreads,
            coreSettled: true,
            sourceErrors,
            error: combinedSourceError(projectSlug, sourceErrors),
            loadState:
              Object.keys(sourceErrors).length > 0
                ? hadSnapshotBeforeLoad
                  ? "stale"
                  : "error"
                : current.loadState,
          });
        });
      });

      await Promise.all([coreCompletion, inventoryCompletion]);
    },
    [branchResource, sharedRecents, updateBranchState],
  );

  const reloadProjectBranch = useCallback(
    async (projectSlug: string) => {
      const normalized = normalizedId(projectSlug);
      if (!normalized) return;
      if (!projectsRef.current.some((project) => project.slug === normalized)) return;
      await startBranchLoad(normalized);
    },
    [startBranchLoad],
  );

  const reloadProjects = useCallback(async () => {
    safelyInvoke(cancelRootRequestRef.current);
    cancelRootRequestRef.current = null;
    const generation = ++rootGenerationRef.current;
    sharedRecentsRef.current.inFlight = null;
    if (mountedRef.current) {
      setProjectsLoading(true);
      setProjectsError(null);
      setProjectsErrorDetail(null);
    }
    try {
      const rootRequest = logicalRequest(
        listProjects({ includeArchived: true }),
        `projects timed out after ${SIDEBAR_HTTP_REQUEST_TIMEOUT_MS}ms`,
      );
      cancelRootRequestRef.current = rootRequest.cancel;
      const nextProjects = await rootRequest.promise;
      if (generation === rootGenerationRef.current) {
        cancelRootRequestRef.current = null;
      }
      if (!mountedRef.current || generation !== rootGenerationRef.current) return;
      const survivingSlugs = new Set(
        nextProjects.map((project) => normalizedId(project.slug)).filter(Boolean),
      );
      for (const slug of branchResourcesRef.current.keys()) {
        if (survivingSlugs.has(slug)) continue;
        closeBranch(slug);
        branchResourcesRef.current.delete(slug);
      }
      const currentStates = branchStatesRef.current;
      const survivingStates = new Map(
        [...currentStates].filter(([slug]) => survivingSlugs.has(slug)),
      );
      if (survivingStates.size !== currentStates.size) {
        branchStatesRef.current = survivingStates;
        setBranchStates(survivingStates);
      }
      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      setProjectsLoading(false);
      const validExpandedProjectIds =
        preferencesRef.current.expandedProjectIds.filter((slug) =>
          survivingSlugs.has(slug),
        );
      if (
        validExpandedProjectIds.length !==
        preferencesRef.current.expandedProjectIds.length
      ) {
        updatePreferences((current) => ({
          ...current,
          expandedProjectIds: current.expandedProjectIds.filter((slug) =>
            survivingSlugs.has(slug),
          ),
        }));
      }
    } catch (error) {
      if (generation === rootGenerationRef.current) {
        cancelRootRequestRef.current = null;
      }
      if (!mountedRef.current || generation !== rootGenerationRef.current) return;
      setProjectsLoading(false);
      setProjectsError(SIDEBAR_PROJECTS_LOAD_ERROR);
      setProjectsErrorDetail(
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "unknown error",
      );
    }
  }, [closeBranch, updatePreferences]);

  const toggleProjectExpanded = useCallback(
    (slug: string) => {
      const normalized = normalizedId(slug);
      if (!normalized || !projectsRef.current.some((project) => project.slug === normalized)) {
        return;
      }
      const currentlyExpanded =
        preferencesRef.current.expandedProjectIds.includes(normalized);
      if (currentlyExpanded) {
        closeBranch(normalized);
      }
      updatePreferences((current) => ({
        ...current,
        expandedProjectIds: toggledId(current.expandedProjectIds, normalized),
      }));
    },
    [closeBranch, updatePreferences],
  );

  const toggleWorkspaceExpanded = useCallback(
    (workspaceId: string) => {
      const normalized = normalizedId(workspaceId);
      if (!normalized) return;
      updatePreferences((current) => ({
        ...current,
        expandedWorkspaceIds: toggledId(current.expandedWorkspaceIds, normalized),
      }));
    },
    [updatePreferences],
  );

  const showAllWorkspaces = useCallback(
    (projectSlug: string) => {
      const normalized = normalizedId(projectSlug);
      if (!normalized || !projectsRef.current.some((project) => project.slug === normalized)) {
        return;
      }
      updatePreferences((current) => ({
        ...current,
        revealedProjectIds: addedId(current.revealedProjectIds, normalized),
      }));
    },
    [updatePreferences],
  );

  const showAllSessions = useCallback(
    (workspaceId: string) => {
      const normalized = normalizedId(workspaceId);
      if (!normalized) return;
      updatePreferences((current) => ({
        ...current,
        revealedWorkspaceIds: addedId(current.revealedWorkspaceIds, normalized),
      }));
    },
    [updatePreferences],
  );

  useEffect(() => {
    mountedRef.current = true;
    void reloadProjects();
    const handleProjectsChanged = () => {
      void reloadProjects();
    };
    window.addEventListener(TRACKER_PROJECTS_CHANGED_EVENT, handleProjectsChanged);
    return () => {
      mountedRef.current = false;
      rootGenerationRef.current += 1;
      const cancelRootRequest = cancelRootRequestRef.current;
      cancelRootRequestRef.current = null;
      safelyInvoke(cancelRootRequest);
      window.removeEventListener(
        TRACKER_PROJECTS_CHANGED_EVENT,
        handleProjectsChanged,
      );
      for (const slug of branchResourcesRef.current.keys()) closeBranch(slug);
    };
  }, [closeBranch, reloadProjects]);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    const expanded = new Set(preferences.expandedProjectIds);
    for (const [slug, resource] of branchResourcesRef.current) {
      if (!expanded.has(slug) && resource.active) closeBranch(slug);
    }
    for (const slug of expanded) {
      if (!projects.some((project) => project.slug === slug)) continue;
      const resource = branchResourcesRef.current.get(slug);
      if (!resource?.active) void startBranchLoad(slug);
    }
  }, [
    closeBranch,
    preferences.expandedProjectIds,
    projects,
    startBranchLoad,
  ]);

  useEffect(() => {
    const previous = previousShowArchivedRef.current;
    previousShowArchivedRef.current = preferences.filters.showArchived;
    if (previous === preferences.filters.showArchived) return;
    for (const slug of preferences.expandedProjectIds) {
      if (projects.some((project) => project.slug === slug)) {
        void startBranchLoad(slug);
      }
    }
  }, [
    preferences.expandedProjectIds,
    preferences.filters.showArchived,
    projects,
    startBranchLoad,
  ]);

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
      expandedProjectIds: addedId(current.expandedProjectIds, slug),
    }));
  }, [projects, routeSelection.projectSlug, updatePreferences]);

  const treeComputation = useMemo(() => {
    const pinnedProjectIds = new Set(preferences.pinnedProjectIds);
    const pinnedWorkspaceIds = new Set(preferences.pinnedWorkspaceIds);
    const pinnedSessionIds = new Set(preferences.pinnedSessionIds);
    const nextCache = new Map<string, SidebarProjectNodeCacheEntry>();
    const visibleProjects = preferences.filters.showArchived
      ? projects
      : projects.filter((project) => project.archivedAt == null);
    const tree = visibleProjects.map((project) => {
      const branch = branchStates.get(project.slug);
      const cached = projectNodeCacheRef.current.get(project.slug);
      if (
        cached?.project === project &&
        cached.branch === branch &&
        cached.preferences === preferences &&
        cached.executions === executions
      ) {
        nextCache.set(project.slug, cached);
        return cached.node;
      }
      const revealSessions = preferences.revealedWorkspaceIds.some((workspaceId) =>
        workspaceId.startsWith(`workspace:${project.slug}:`),
      );
      const node = buildSidebarProjectTree({
        projectSlug: project.slug,
        projectTitle: project.name,
        archived: project.archivedAt != null,
        issues: branch?.issues ?? [],
        executions,
        relatedSessions: branch?.relatedSessions ?? [],
        assistantThreads: branch?.assistantThreads ?? [],
        inventory: branch
          ? [
              ...(
                branch.draftInventoryByPath ??
                branch.completedInventoryByPath
              ).values(),
            ]
          : [],
        loadState: branch?.loadState ?? "idle",
        error: branch?.error ?? null,
        options: {
          pinnedProjectIds,
          pinnedWorkspaceIds,
          pinnedSessionIds,
          lastReadAtBySession: preferences.lastReadAtBySession,
          sortMode: preferences.sort,
          groupMode: preferences.group,
          filters: {
            statuses: preferences.filters.statuses,
            agents: preferences.filters.agents,
            showArchived: preferences.filters.showArchived,
            activityOnly: preferences.filters.activityOnly,
          },
          workspaceLimit: preferences.revealedProjectIds.includes(project.slug)
            ? UNLIMITED_SIDEBAR_NODES
            : undefined,
          sessionLimit: revealSessions ? UNLIMITED_SIDEBAR_NODES : undefined,
        },
      });
      nextCache.set(project.slug, {
        project,
        branch,
        preferences,
        executions,
        node,
      });
      return node;
    });
    return { tree, nextCache };
  }, [branchStates, executions, preferences, projects]);
  const tree = treeComputation.tree;

  useEffect(() => {
    projectNodeCacheRef.current = treeComputation.nextCache;
  }, [treeComputation]);

  useEffect(() => {
    const ancestors = ancestorIdsForSelection(routeSelection, tree);
    if (ancestors.workspaceIds.length === 0) return;
    const missingWorkspaceIds = ancestors.workspaceIds.filter(
      (id) => !preferencesRef.current.expandedWorkspaceIds.includes(id),
    );
    if (missingWorkspaceIds.length === 0) return;
    updatePreferences((current) => ({
      ...current,
      expandedWorkspaceIds: [
        ...current.expandedWorkspaceIds,
        ...missingWorkspaceIds.filter(
          (id) => !current.expandedWorkspaceIds.includes(id),
        ),
      ],
    }));
  }, [routeSelection, tree, updatePreferences]);

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
