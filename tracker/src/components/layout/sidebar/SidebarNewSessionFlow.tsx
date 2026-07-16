import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ExecutionSettingsFields } from "@/components/assistant/ExecutionSettingsFields";
import { NewStandaloneWorkspaceDialog } from "@/components/sessions/NewStandaloneWorkspaceDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  catalogFor,
  defaultComposerSettings,
  fallbackCatalogBundle,
  type AssistantCatalogBundle,
} from "@/lib/assistantSettings";
import type { SidebarRouteSelection } from "@/lib/sidebarRouteResolution";
import { cn } from "@/lib/utils";
import { workspaceCloneRepoOptions } from "@/lib/workspaceCloneRepos";
import { fetchAssistantCatalogBundle } from "@/services/assistant";
import {
  createFreeformThread,
  createIssueSessionThread,
  createProjectSessionThread,
} from "@/services/assistantThreads";
import { listIssues } from "@/services/issues";
import { getProject } from "@/services/projects";
import type { AgentKind, Issue } from "@/types/issue";
import type { WorkspaceRepository } from "@/types/repository";
import type { SidebarProjectNode, SidebarWorkspaceNode } from "@/types/sidebar";

const MAX_TITLE_LENGTH = 160;
const MAX_SEED_LENGTH = 8000;
const SELECT_CLASS = "h-9 w-full min-w-0 rounded-md border bg-background px-2";
const SEGMENT_CLASS =
  "inline-flex h-9 flex-1 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors";

export type SessionTopType = "livre" | "projeto";
export type ProjectSessionKind = "issue" | "explore";

export interface SidebarNewSessionCreated {
  readonly scope: "freeform" | "project_session" | "issue_session";
  readonly projectSlug: string | null;
  readonly threadId: number;
  readonly seed?: string;
}

export interface SidebarNewSessionFlowProps {
  readonly open: boolean;
  readonly selection: SidebarRouteSelection;
  readonly tree: readonly SidebarProjectNode[];
  readonly initialProjectId?: string | null;
  readonly initialWorkspaceId?: string | null;
  onOpenChange(open: boolean): void;
  ensureProjectExpanded?(projectId: string): void | Promise<void>;
  onCreated(result: SidebarNewSessionCreated): void;
}

export function SidebarNewSessionFlow({
  open,
  selection,
  tree,
  initialProjectId = null,
  initialWorkspaceId = null,
  onOpenChange,
  ensureProjectExpanded,
  onCreated,
}: SidebarNewSessionFlowProps) {
  const { t } = useTranslation();
  const projects = useMemo(() => safeProjects(tree), [tree]);
  const [topType, setTopType] = useState<SessionTopType>("livre");
  const [projectKind, setProjectKind] = useState<ProjectSessionKind>("explore");
  const [projectId, setProjectId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [issueQuery, setIssueQuery] = useState("");
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [issueResults, setIssueResults] = useState<Issue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [seed, setSeed] = useState("");
  const [agent, setAgent] = useState<AgentKind>("codex");
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [bundle, setBundle] = useState<AssistantCatalogBundle>(() => fallbackCatalogBundle());
  const [submitting, setSubmitting] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [configuredRepos, setConfiguredRepos] = useState<WorkspaceRepository[]>([]);
  const loadedRequests = useRef(new Set<string>());
  const successDelivered = useRef(false);
  const submissionInFlight = useRef(false);
  const submitGeneration = useRef(0);
  const openRef = useRef(open);
  const initializedSelectionKey = useRef<string | null>(null);
  const userTouchedWorkspace = useRef(false);
  const debouncedIssueQuery = useDebouncedValue(issueQuery, 200);

  openRef.current = open;

  const selectedProject = projects.find((project) => project.id === projectId) ?? null;
  const standaloneCloneRepos = useMemo(() => {
    if (!selectedProject) return [];
    return workspaceCloneRepoOptions(projectRepos(selectedProject), configuredRepos);
  }, [configuredRepos, selectedProject]);
  const workspaces = useMemo(() => {
    if (!selectedProject) return [] as SidebarWorkspaceNode[];
    return [...selectedProject.workspaces, ...selectedProject.overflowWorkspaces].filter(
      (workspace) =>
        workspace.workspaceKind !== "orphan" &&
        Boolean(workspace.inventory?.path?.startsWith("/")),
    );
  }, [selectedProject]);
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === workspaceId) ?? null;

  useEffect(() => {
    if (!open) {
      submitGeneration.current += 1;
      setTopType("livre");
      setProjectKind("explore");
      setProjectId("");
      setWorkspaceId("");
      setIssueQuery("");
      setSelectedIssue(null);
      setIssueResults([]);
      setTitle("");
      setSeed("");
      setAgent("codex");
      setModel(null);
      setEffort(null);
      setBundle(fallbackCatalogBundle());
      setSubmitting(false);
      setServiceError(null);
      setNewWorkspaceOpen(false);
      loadedRequests.current.clear();
      successDelivered.current = false;
      submissionInFlight.current = false;
      initializedSelectionKey.current = null;
      userTouchedWorkspace.current = false;
      return;
    }

    const selectionKey = [
      initialProjectId ?? "",
      initialWorkspaceId ?? "",
      selection.projectSlug ?? "",
      selection.workspaceId ?? "",
      selection.sessionId ?? "",
    ].join("\u0000");
    if (initializedSelectionKey.current === selectionKey) return;
    initializedSelectionKey.current = selectionKey;
    userTouchedWorkspace.current = false;
    successDelivered.current = false;
    setServiceError(null);

    const initial = resolveInitialSelection(
      projects,
      selection,
      initialProjectId,
      initialWorkspaceId,
    );
    setTopType(initial.projectId ? "projeto" : "livre");
    setProjectKind(initial.issueHint ? "issue" : "explore");
    setProjectId(initial.projectId);
    setWorkspaceId(initial.workspaceId);
    setIssueQuery(initial.issueHint ?? "");
    setSelectedIssue(null);
    setTitle("");
    setSeed("");
  }, [
    initialProjectId,
    initialWorkspaceId,
    open,
    projects,
    selection.projectSlug,
    selection.sessionId,
    selection.workspaceId,
  ]);

  useEffect(() => {
    if (!open || topType !== "projeto" || !projectId || userTouchedWorkspace.current) return;
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project || project.loadState !== "ready") return;

    if (workspaceId) {
      const stillThere = [...project.workspaces, ...project.overflowWorkspaces].some(
        (workspace) => workspace.id === workspaceId,
      );
      if (!stillThere) setWorkspaceId("");
      return;
    }

    const preferred =
      resolveWorkspaceForRoute(project, selection, initialWorkspaceId) ??
      defaultExploreWorkspace(project);
    if (preferred) setWorkspaceId(preferred.id);
  }, [
    initialWorkspaceId,
    open,
    projectId,
    projects,
    selection,
    topType,
    workspaceId,
  ]);

  useEffect(() => {
    if (
      !open ||
      topType !== "projeto" ||
      !selectedProject ||
      selectedProject.loadState === "ready" ||
      selectedProject.loadState === "error" ||
      loadedRequests.current.has(selectedProject.id)
    ) {
      return;
    }
    loadedRequests.current.add(selectedProject.id);
    void ensureProjectExpanded?.(selectedProject.id);
  }, [ensureProjectExpanded, open, selectedProject, topType]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const slug = selectedProject?.projectSlug;
    if (!slug) {
      setBundle(fallbackCatalogBundle());
      return;
    }
    void fetchAssistantCatalogBundle(slug)
      .then((next) => {
        if (!active) return;
        setBundle(next);
        const defaults = defaultComposerSettings(catalogFor(next, agent));
        setModel((current) => current ?? defaults.model);
        setEffort((current) => current ?? defaults.effort);
      })
      .catch(() => {
        if (!active) return;
        setBundle(fallbackCatalogBundle());
      });
    return () => {
      active = false;
    };
  }, [agent, open, selectedProject?.projectSlug]);

  useEffect(() => {
    if (!open || topType !== "projeto" || projectKind !== "issue" || !selectedProject) {
      setIssueResults([]);
      return;
    }
    let active = true;
    setIssuesLoading(true);
    void listIssues(selectedProject.projectSlug, {
      search: debouncedIssueQuery.trim() || undefined,
    })
      .then((loaded) => {
        if (active) setIssueResults(loaded);
      })
      .catch(() => {
        if (active) setIssueResults([]);
      })
      .finally(() => {
        if (active) setIssuesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debouncedIssueQuery, open, projectKind, selectedProject, topType]);

  useEffect(() => {
    if (!newWorkspaceOpen || !selectedProject) return;
    let active = true;
    void getProject(selectedProject.projectSlug)
      .then((project) => {
        if (active) setConfiguredRepos(project.repositories ?? []);
      })
      .catch(() => {
        if (active) setConfiguredRepos([]);
      });
    return () => {
      active = false;
    };
  }, [newWorkspaceOpen, selectedProject]);

  const unavailableReason = submissionUnavailableReason({
    topType,
    projectKind,
    project: selectedProject,
    workspace: selectedWorkspace,
    issue: selectedIssue,
    t,
  });

  function changeProject(nextProjectId: string) {
    userTouchedWorkspace.current = false;
    setProjectId(nextProjectId);
    setWorkspaceId("");
    setSelectedIssue(null);
    setIssueQuery("");
    setServiceError(null);
  }

  function changeWorkspace(nextWorkspaceId: string) {
    userTouchedWorkspace.current = true;
    setWorkspaceId(nextWorkspaceId);
    setServiceError(null);
  }

  function resolveTitle(): string | undefined {
    const explicit = title.trim();
    if (explicit) return explicit.slice(0, MAX_TITLE_LENGTH);
    const fromSeed = seed.trim();
    if (fromSeed) return fromSeed.slice(0, MAX_TITLE_LENGTH);
    if (selectedIssue) {
      return `${selectedIssue.identifier} ${selectedIssue.title}`.trim().slice(0, MAX_TITLE_LENGTH);
    }
    return t("layout.sidebar.newSession.fallbackTitle");
  }

  async function submit() {
    if (submissionInFlight.current || submitting || unavailableReason) return;
    if (topType === "projeto" && projectKind === "issue" && (!selectedProject || !selectedIssue)) {
      return;
    }
    if (
      topType === "projeto" &&
      projectKind === "explore" &&
      (!selectedProject || !selectedWorkspace?.inventory?.path)
    ) {
      return;
    }

    const generation = ++submitGeneration.current;
    submissionInFlight.current = true;
    setSubmitting(true);
    setServiceError(null);

    const resolvedTitle = resolveTitle();
    const seedTrimmed = seed.trim();
    const createInput = {
      ...(resolvedTitle ? { title: resolvedTitle } : {}),
      agentKind: agent,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
    };

    try {
      let result: SidebarNewSessionCreated;
      if (topType === "livre") {
        const thread = await createFreeformThread(createInput);
        result = {
          scope: "freeform",
          projectSlug: null,
          threadId: thread.id,
          ...(seedTrimmed ? { seed: seedTrimmed } : {}),
        };
      } else if (projectKind === "issue" && selectedProject && selectedIssue) {
        const thread = await createIssueSessionThread(
          selectedProject.projectSlug,
          selectedIssue.identifier,
          createInput,
        );
        result = {
          scope: "issue_session",
          projectSlug: selectedProject.projectSlug,
          threadId: thread.id,
          ...(seedTrimmed ? { seed: seedTrimmed } : {}),
        };
      } else if (selectedProject && selectedWorkspace?.inventory?.path) {
        const thread = await createProjectSessionThread(selectedProject.projectSlug, {
          ...createInput,
          workspacePath: selectedWorkspace.inventory.path,
        });
        result = {
          scope: "project_session",
          projectSlug: selectedProject.projectSlug,
          threadId: thread.id,
          ...(seedTrimmed ? { seed: seedTrimmed } : {}),
        };
      } else {
        return;
      }

      if (
        generation !== submitGeneration.current ||
        !openRef.current ||
        successDelivered.current
      ) {
        return;
      }
      complete(result);
    } catch (cause) {
      if (generation !== submitGeneration.current || !openRef.current) return;
      setServiceError(
        cause instanceof Error
          ? cause.message
          : t("layout.sidebar.newSession.serviceError"),
      );
    } finally {
      if (generation !== submitGeneration.current) return;
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  }

  function complete(result: SidebarNewSessionCreated) {
    if (successDelivered.current || !openRef.current) return;
    successDelivered.current = true;
    onOpenChange(false);
    onCreated(result);
  }

  function handleDialogOpenChange(next: boolean) {
    if (!next && (submitting || submissionInFlight.current)) return;
    if (!next && newWorkspaceOpen) return;
    onOpenChange(next);
  }

  function retryProject() {
    if (!selectedProject || !ensureProjectExpanded) return;
    loadedRequests.current.delete(selectedProject.id);
    loadedRequests.current.add(selectedProject.id);
    void ensureProjectExpanded(selectedProject.id);
  }

  const sessionDialogOpen = open && !newWorkspaceOpen;

  return (
    <>
      <Dialog open={sessionDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("layout.sidebar.newSession.title")}</DialogTitle>
            <DialogDescription>
              {t("layout.sidebar.newSession.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-3">
            <label className="grid gap-1 text-sm">
              <span>{t("layout.sidebar.newSession.sessionTitle")}</span>
              <Input
                aria-label={t("layout.sidebar.newSession.sessionTitle")}
                value={title}
                maxLength={MAX_TITLE_LENGTH}
                disabled={submitting}
                placeholder={t("layout.sidebar.newSession.sessionTitleOptional")}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <fieldset className="grid gap-1 text-sm">
              <legend className="mb-1">{t("layout.sidebar.newSession.type")}</legend>
              <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
                <button
                  type="button"
                  className={cn(
                    SEGMENT_CLASS,
                    topType === "livre"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={topType === "livre"}
                  disabled={submitting}
                  onClick={() => {
                    setTopType("livre");
                    setServiceError(null);
                  }}
                >
                  {t("layout.sidebar.newSession.typeFree")}
                </button>
                <button
                  type="button"
                  className={cn(
                    SEGMENT_CLASS,
                    topType === "projeto"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={topType === "projeto"}
                  disabled={submitting}
                  onClick={() => {
                    setTopType("projeto");
                    setServiceError(null);
                  }}
                >
                  {t("layout.sidebar.newSession.typeProject")}
                </button>
              </div>
              {topType === "livre" ? (
                <p className="text-xs text-muted-foreground">
                  {t("layout.sidebar.newSession.freeHint")}
                </p>
              ) : null}
            </fieldset>

            {topType === "projeto" ? (
              <>
                <label className="grid gap-1 text-sm">
                  <span>{t("layout.sidebar.newSession.project")}</span>
                  <select
                    aria-label={t("layout.sidebar.newSession.project")}
                    className={SELECT_CLASS}
                    value={projectId}
                    disabled={submitting}
                    onChange={(event) => changeProject(event.target.value)}
                  >
                    <option value="">{t("layout.sidebar.newSession.selectProject")}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                  </select>
                </label>

                <fieldset className="grid gap-1 text-sm">
                  <legend className="mb-1">
                    {t("layout.sidebar.newSession.projectKind")}
                  </legend>
                  <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
                    <button
                      type="button"
                      className={cn(
                        SEGMENT_CLASS,
                        projectKind === "issue"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      aria-pressed={projectKind === "issue"}
                      disabled={submitting}
                      onClick={() => {
                        setProjectKind("issue");
                        setServiceError(null);
                      }}
                    >
                      {t("layout.sidebar.newSession.kindIssue")}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        SEGMENT_CLASS,
                        projectKind === "explore"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      aria-pressed={projectKind === "explore"}
                      disabled={submitting}
                      onClick={() => {
                        setProjectKind("explore");
                        setServiceError(null);
                      }}
                    >
                      {t("layout.sidebar.newSession.kindExplore")}
                    </button>
                  </div>
                </fieldset>

                {projectKind === "issue" ? (
                  <div className="grid gap-1 text-sm">
                    <label htmlFor="new-session-issue" className="text-sm">
                      {t("layout.sidebar.newSession.issue")}
                    </label>
                    <Input
                      id="new-session-issue"
                      aria-label={t("layout.sidebar.newSession.issue")}
                      value={
                        selectedIssue
                          ? `${selectedIssue.identifier} — ${selectedIssue.title}`
                          : issueQuery
                      }
                      disabled={submitting || !selectedProject}
                      placeholder={t("layout.sidebar.newSession.issuePlaceholder")}
                      onChange={(event) => {
                        setSelectedIssue(null);
                        setIssueQuery(event.target.value);
                      }}
                    />
                    {selectedIssue ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 justify-start px-2"
                        disabled={submitting}
                        onClick={() => {
                          setSelectedIssue(null);
                          setIssueQuery("");
                        }}
                      >
                        {t("layout.sidebar.newSession.clearIssue")}
                      </Button>
                    ) : (
                      <ul
                        className="max-h-40 overflow-auto rounded-md border bg-background"
                        role="listbox"
                        aria-label={t("layout.sidebar.newSession.issueResults")}
                      >
                        {issuesLoading ? (
                          <li className="px-3 py-2 text-xs text-muted-foreground">
                            {t("layout.sidebar.newSession.loadingIssues")}
                          </li>
                        ) : issueResults.length === 0 ? (
                          <li className="px-3 py-2 text-xs text-muted-foreground">
                            {t("layout.sidebar.newSession.noIssues")}
                          </li>
                        ) : (
                          issueResults.slice(0, 20).map((issue) => (
                            <li key={issue.identifier}>
                              <button
                                type="button"
                                role="option"
                                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted"
                                onClick={() => {
                                  setSelectedIssue(issue);
                                  setIssueQuery("");
                                }}
                              >
                                <span className="font-mono text-xs">{issue.identifier}</span>
                                <span className="line-clamp-1 text-sm">{issue.title}</span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                ) : (
                  <>
                    <label className="grid gap-1 text-sm">
                      <span>{t("layout.sidebar.newSession.workspace")}</span>
                      <select
                        aria-label={t("layout.sidebar.newSession.workspace")}
                        className={SELECT_CLASS}
                        value={workspaceId}
                        disabled={
                          !selectedProject ||
                          selectedProject.loadState !== "ready" ||
                          submitting
                        }
                        onChange={(event) => changeWorkspace(event.target.value)}
                      >
                        <option value="">
                          {t("layout.sidebar.newSession.selectWorkspace")}
                        </option>
                        {workspaces.map((workspace) => (
                          <option key={workspace.id} value={workspace.id}>
                            {workspace.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedProject ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={submitting}
                        onClick={() => setNewWorkspaceOpen(true)}
                      >
                        {t("layout.sidebar.newSession.createWorkspace")}
                      </Button>
                    ) : null}
                  </>
                )}
              </>
            ) : null}

            <ExecutionSettingsFields
              bundle={bundle}
              agent={agent}
              model={model}
              effort={effort}
              disabled={submitting}
              onAgentChange={(next) => setAgent(next ?? "codex")}
              onModelChange={setModel}
              onEffortChange={setEffort}
            />

            <label className="grid gap-1 text-sm">
              <span>{t("layout.sidebar.newSession.seed")}</span>
              <Textarea
                aria-label={t("layout.sidebar.newSession.seed")}
                value={seed}
                maxLength={MAX_SEED_LENGTH}
                disabled={submitting}
                rows={3}
                placeholder={t("layout.sidebar.newSession.seedPlaceholder")}
                onChange={(event) => setSeed(event.target.value)}
              />
            </label>

            {selectedProject?.loadState === "error" ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-2 text-sm text-destructive"
              >
                <span>
                  {selectedProject.error ?? t("layout.sidebar.newSession.loadError")}
                </span>
                <Button type="button" size="sm" variant="outline" onClick={retryProject}>
                  {t("layout.sidebar.newSession.retry")}
                </Button>
              </div>
            ) : null}
            {topType === "projeto" &&
            selectedProject &&
            selectedProject.loadState !== "ready" &&
            selectedProject.loadState !== "error" ? (
              <p className="text-sm text-muted-foreground">
                {t("layout.sidebar.newSession.loading")}
              </p>
            ) : null}
            {unavailableReason ? (
              <p role="status" className="text-sm text-muted-foreground">
                {unavailableReason}
              </p>
            ) : null}
            {serviceError ? (
              <p role="alert" className="text-sm text-destructive">
                {serviceError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                {t("layout.sidebar.newSession.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={Boolean(unavailableReason) || submitting}
              onClick={(event) => {
                if (event.detail > 1) return;
                void submit();
              }}
            >
              {submitting
                ? t("layout.sidebar.newSession.creating")
                : t("layout.sidebar.newSession.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedProject ? (
        <NewStandaloneWorkspaceDialog
          projectSlug={selectedProject.projectSlug}
          cloneRepos={standaloneCloneRepos}
          open={newWorkspaceOpen}
          onOpenChange={(next) => {
            setNewWorkspaceOpen(next);
            if (!next) setConfiguredRepos([]);
          }}
          onCreated={(_workspacePath, threadId) =>
            complete({
              scope: "project_session",
              projectSlug: selectedProject.projectSlug,
              threadId,
            })
          }
        />
      ) : null}
    </>
  );
}

function safeProjects(tree: unknown): SidebarProjectNode[] {
  if (!Array.isArray(tree)) return [];
  return tree.filter(
    (candidate): candidate is SidebarProjectNode =>
      candidate?.kind === "project" &&
      typeof candidate.id === "string" &&
      typeof candidate.projectSlug === "string" &&
      Array.isArray(candidate.workspaces) &&
      Array.isArray(candidate.overflowWorkspaces),
  );
}

function resolveInitialSelection(
  projects: readonly SidebarProjectNode[],
  selection: SidebarRouteSelection,
  initialProjectId: string | null,
  initialWorkspaceId: string | null,
): {
  projectId: string;
  workspaceId: string;
  issueHint: string | null;
} {
  const requestedProjectId = initialProjectId ?? selection.projectSlug ?? "";
  const project =
    projects.find(
      (candidate) =>
        candidate.id === requestedProjectId ||
        candidate.projectSlug === requestedProjectId,
    ) ?? null;
  if (!project) {
    return { projectId: "", workspaceId: "", issueHint: null };
  }

  const requestedWorkspaceId = initialWorkspaceId ?? selection.workspaceId;
  const restored = resolveWorkspaceForRoute(project, selection, requestedWorkspaceId);
  const issueHint =
    restored?.issueIdentifier?.trim() ||
    (selection.sessionId?.startsWith("authoring:")
      ? selection.sessionId.slice("authoring:".length)
      : null);

  return {
    projectId: project.id,
    workspaceId: restored?.id ?? defaultExploreWorkspace(project)?.id ?? "",
    issueHint,
  };
}

function resolveWorkspaceForRoute(
  project: SidebarProjectNode,
  selection: SidebarRouteSelection,
  requestedWorkspaceId: string | null,
): SidebarWorkspaceNode | null {
  const workspaces = [...project.workspaces, ...project.overflowWorkspaces];
  if (requestedWorkspaceId) {
    return workspaces.find(({ id }) => id === requestedWorkspaceId) ?? null;
  }
  if (!selection.sessionId) return null;
  return (
    workspaces.find((candidate) =>
      [...candidate.sessions, ...candidate.overflowSessions].some(
        (session) => session.id === selection.sessionId,
      ),
    ) ?? null
  );
}

function defaultExploreWorkspace(
  project: SidebarProjectNode,
): SidebarWorkspaceNode | null {
  const workspaces = [...project.workspaces, ...project.overflowWorkspaces];
  return (
    workspaces.find(
      (workspace) =>
        workspace.workspaceKind === "project" &&
        workspace.inventory?.path?.startsWith("/"),
    ) ??
    workspaces.find(
      (workspace) =>
        workspace.workspaceKind === "standalone" &&
        workspace.inventory?.path?.startsWith("/"),
    ) ??
    workspaces.find((workspace) => workspace.inventory?.path?.startsWith("/")) ??
    null
  );
}

function submissionUnavailableReason({
  topType,
  projectKind,
  project,
  workspace,
  issue,
  t,
}: {
  topType: SessionTopType;
  projectKind: ProjectSessionKind;
  project: SidebarProjectNode | null;
  workspace: SidebarWorkspaceNode | null;
  issue: Issue | null;
  t: ReturnType<typeof useTranslation>["t"];
}): string | null {
  if (topType === "livre") return null;
  if (!project) return t("layout.sidebar.newSession.requireProject");
  if (project.loadState !== "ready") {
    return t("layout.sidebar.newSession.requireReadyProject");
  }
  if (projectKind === "issue") {
    if (!issue) return t("layout.sidebar.newSession.requireIssue");
    return null;
  }
  if (!workspace) return t("layout.sidebar.newSession.requireWorkspace");
  if (!workspace.inventory?.path?.startsWith("/")) {
    return t("layout.sidebar.newSession.missingWorkspacePath");
  }
  return null;
}

function projectRepos(project: SidebarProjectNode) {
  const main = [...project.workspaces, ...project.overflowWorkspaces].find(
    (workspace) => workspace.workspaceKind === "project" && workspace.inventory,
  );
  return main?.inventory?.repos ?? [];
}
