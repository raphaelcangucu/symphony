import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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
import type { SidebarRouteSelection } from "@/lib/sidebarRouteResolution";
import {
  createIssueSessionThread,
  createProjectSessionThread,
} from "@/services/assistantThreads";
import { workspaceCloneRepoOptions } from "@/lib/workspaceCloneRepos";
import { getProject } from "@/services/projects";
import type { WorkspaceRepository } from "@/types/repository";
import type { SidebarProjectNode, SidebarWorkspaceNode } from "@/types/sidebar";

const MAX_TITLE_LENGTH = 160;
const SELECT_CLASS = "h-9 w-full min-w-0 rounded-md border bg-background px-2";
const SUPPORTED_AGENT_KINDS = ["codex", "claude", "cursor"] as const;
type SupportedAgentKind = (typeof SUPPORTED_AGENT_KINDS)[number];
type FlowPhase = "confirm" | "edit" | "select";

export interface SidebarNewSessionFlowProps {
  readonly open: boolean;
  readonly selection: SidebarRouteSelection;
  readonly tree: readonly SidebarProjectNode[];
  readonly initialProjectId?: string | null;
  readonly initialWorkspaceId?: string | null;
  onOpenChange(open: boolean): void;
  ensureProjectExpanded?(projectId: string): void | Promise<void>;
  onCreated(projectSlug: string, threadId: number): void;
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
  const [projectId, setProjectId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [title, setTitle] = useState("");
  const [agentKind, setAgentKind] = useState<SupportedAgentKind | "">("");
  const [phase, setPhase] = useState<FlowPhase>("select");
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
  const routeRestorePending = useRef(false);
  const userTouchedWorkspace = useRef(false);
  const requestedWorkspaceIdRef = useRef<string | null>(null);

  openRef.current = open;

  const selectedProject = projects.find((project) => project.id === projectId) ?? null;
  const standaloneCloneRepos = useMemo(() => {
    if (!selectedProject) return [];
    return workspaceCloneRepoOptions(projectRepos(selectedProject), configuredRepos);
  }, [configuredRepos, selectedProject]);
  const workspaces = selectedProject
    ? [...selectedProject.workspaces, ...selectedProject.overflowWorkspaces]
    : [];
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const requestedWorkspaceId =
    requestedWorkspaceIdRef.current ?? initialWorkspaceId ?? selection.workspaceId;
  const routeWorkspaceMissing =
    Boolean(selectedProject?.loadState === "ready") &&
    Boolean(requestedWorkspaceId) &&
    !workspaces.some((workspace) => workspace.id === requestedWorkspaceId) &&
    !selectedWorkspace;

  useEffect(() => {
    if (!open) {
      submitGeneration.current += 1;
      setProjectId("");
      setWorkspaceId("");
      setTitle("");
      setAgentKind("");
      setPhase("select");
      setSubmitting(false);
      setServiceError(null);
      setNewWorkspaceOpen(false);
      loadedRequests.current.clear();
      successDelivered.current = false;
      submissionInFlight.current = false;
      initializedSelectionKey.current = null;
      routeRestorePending.current = false;
      userTouchedWorkspace.current = false;
      requestedWorkspaceIdRef.current = null;
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
    requestedWorkspaceIdRef.current = initial.requestedWorkspaceId;
    setProjectId(initial.projectId);
    setWorkspaceId(initial.workspaceId);

    const project =
      projects.find((candidate) => candidate.id === initial.projectId) ?? null;
    const workspaceReady =
      Boolean(initial.workspaceId) && project?.loadState === "ready";
    routeRestorePending.current =
      Boolean(initial.projectId) &&
      Boolean(initial.requestedWorkspaceId || selection.sessionId) &&
      !workspaceReady;
    setPhase(workspaceReady ? "confirm" : "select");
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
    if (!open || !projectId || userTouchedWorkspace.current) return;

    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      setProjectId("");
      setWorkspaceId("");
      setPhase("select");
      return;
    }

    if (project.loadState !== "ready") return;

    const restored = resolveWorkspaceForRoute(
      project,
      selection,
      initialWorkspaceId ?? requestedWorkspaceIdRef.current,
    );

    if (restored) {
      if (workspaceId !== restored.id) setWorkspaceId(restored.id);
      if (routeRestorePending.current || phase === "select") {
        routeRestorePending.current = false;
        setPhase("confirm");
      }
      return;
    }

    if (routeRestorePending.current) {
      routeRestorePending.current = false;
      if (workspaceId) setWorkspaceId("");
      setPhase("select");
    } else if (
      workspaceId &&
      ![...project.workspaces, ...project.overflowWorkspaces].some(
        (workspace) => workspace.id === workspaceId,
      )
    ) {
      setWorkspaceId("");
    }
  }, [
    initialWorkspaceId,
    open,
    phase,
    projectId,
    projects,
    selection,
    workspaceId,
  ]);

  useEffect(() => {
    if (
      !open ||
      !selectedProject ||
      selectedProject.loadState === "ready" ||
      selectedProject.loadState === "error" ||
      loadedRequests.current.has(selectedProject.id)
    ) {
      return;
    }
    loadedRequests.current.add(selectedProject.id);
    void ensureProjectExpanded?.(selectedProject.id);
  }, [ensureProjectExpanded, open, selectedProject]);

  const unavailableReason = submissionUnavailableReason(
    selectedProject,
    selectedWorkspace,
    t,
  );

  function changeProject(nextProjectId: string) {
    userTouchedWorkspace.current = true;
    routeRestorePending.current = false;
    setProjectId(nextProjectId);
    setWorkspaceId("");
    setServiceError(null);
    if (phase === "confirm") setPhase("edit");
  }

  function changeWorkspace(nextWorkspaceId: string) {
    userTouchedWorkspace.current = true;
    routeRestorePending.current = false;
    setWorkspaceId(nextWorkspaceId);
    setServiceError(null);
  }

  async function submit() {
    if (
      phase === "edit" ||
      submissionInFlight.current ||
      submitting ||
      unavailableReason ||
      !selectedProject ||
      !selectedWorkspace
    ) {
      return;
    }
    const generation = ++submitGeneration.current;
    submissionInFlight.current = true;
    setSubmitting(true);
    setServiceError(null);

    try {
      const input = {
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(agentKind ? { agentKind } : {}),
        workspacePath: selectedWorkspace.inventory!.path,
      };
      const thread =
        selectedWorkspace.workspaceKind === "issue" ||
        selectedWorkspace.workspaceKind === "parallel"
          ? await createIssueSessionThread(
              selectedProject.projectSlug,
              selectedWorkspace.issueIdentifier!,
              input,
            )
          : await createProjectSessionThread(selectedProject.projectSlug, input);
      if (
        generation !== submitGeneration.current ||
        !openRef.current ||
        successDelivered.current
      ) {
        return;
      }
      complete(selectedProject.projectSlug, thread.id);
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

  function complete(projectSlug: string, threadId: number) {
    if (successDelivered.current || !openRef.current) return;
    successDelivered.current = true;
    onOpenChange(false);
    onCreated(projectSlug, threadId);
  }

  function handleDialogOpenChange(next: boolean) {
    if (!next && (submitting || submissionInFlight.current)) return;
    if (!next && newWorkspaceOpen) return;
    onOpenChange(next);
  }

  function handleWorkspaceDialogOpenChange(next: boolean) {
    setNewWorkspaceOpen(next);
    if (!next) setConfiguredRepos([]);
  }

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

  function retryProject() {
    if (!selectedProject || !ensureProjectExpanded) return;
    loadedRequests.current.delete(selectedProject.id);
    loadedRequests.current.add(selectedProject.id);
    void ensureProjectExpanded(selectedProject.id);
  }

  function reviewSelection() {
    if (!selectedProject || selectedProject.loadState !== "ready" || !selectedWorkspace) {
      return;
    }
    setPhase("confirm");
  }

  const showSelectors = phase !== "confirm";
  const agentLabel = agentKind
    ? t(`assistant.catalog.agents.${agentKind}`)
    : t("layout.sidebar.newSession.defaultAgent");

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
            {phase === "confirm" && selectedProject && selectedWorkspace ? (
              <div
                data-testid="new-session-confirmation"
                className="space-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm"
              >
                <p>
                  <span className="text-muted-foreground">
                    {t("layout.sidebar.newSession.project")}:{" "}
                  </span>
                  {selectedProject.title}
                </p>
                <p>
                  <span className="text-muted-foreground">
                    {t("layout.sidebar.newSession.workspace")}:{" "}
                  </span>
                  {selectedWorkspace.title}
                </p>
                <p>
                  <span className="text-muted-foreground">
                    {t("layout.sidebar.newSession.agent")}:{" "}
                  </span>
                  {agentLabel}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 px-2"
                  disabled={submitting}
                  onClick={() => setPhase("edit")}
                >
                  {t("layout.sidebar.newSession.change")}
                </Button>
              </div>
            ) : null}

            {showSelectors ? (
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
                    <option value="">{t("layout.sidebar.newSession.selectWorkspace")}</option>
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
            ) : null}

            <label className="grid gap-1 text-sm">
              <span>{t("layout.sidebar.newSession.sessionTitle")}</span>
              <Input
                aria-label={t("layout.sidebar.newSession.sessionTitle")}
                value={title}
                maxLength={MAX_TITLE_LENGTH}
                disabled={submitting}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span>{t("layout.sidebar.newSession.agent")}</span>
              <select
                aria-label={t("layout.sidebar.newSession.agent")}
                className={SELECT_CLASS}
                value={agentKind}
                disabled={submitting}
                onChange={(event) =>
                  setAgentKind(
                    SUPPORTED_AGENT_KINDS.includes(
                      event.target.value as SupportedAgentKind,
                    )
                      ? (event.target.value as SupportedAgentKind)
                      : "",
                  )
                }
              >
                <option value="">{t("layout.sidebar.newSession.defaultAgent")}</option>
                {SUPPORTED_AGENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`assistant.catalog.agents.${kind}`)}
                  </option>
                ))}
              </select>
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
            {selectedProject &&
            selectedProject.loadState !== "ready" &&
            selectedProject.loadState !== "error" ? (
              <p className="text-sm text-muted-foreground">
                {t("layout.sidebar.newSession.loading")}
              </p>
            ) : null}
            {routeWorkspaceMissing ? (
              <p role="alert" className="text-sm text-destructive">
                {t("layout.sidebar.newSession.workspaceGone")}
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
            {phase === "edit" ? (
              <Button
                type="button"
                disabled={Boolean(unavailableReason) || submitting}
                onClick={reviewSelection}
              >
                {t("layout.sidebar.newSession.review")}
              </Button>
            ) : (
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
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedProject ? (
        <NewStandaloneWorkspaceDialog
          projectSlug={selectedProject.projectSlug}
          cloneRepos={standaloneCloneRepos}
          open={newWorkspaceOpen}
          onOpenChange={handleWorkspaceDialogOpenChange}
          onCreated={(_workspacePath, threadId) =>
            complete(selectedProject.projectSlug, threadId)
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
  requestedWorkspaceId: string | null;
} {
  const requestedProjectId = initialProjectId ?? selection.projectSlug ?? "";
  const project =
    projects.find(
      (candidate) =>
        candidate.id === requestedProjectId ||
        candidate.projectSlug === requestedProjectId,
    ) ?? null;
  if (!project) {
    return { projectId: "", workspaceId: "", requestedWorkspaceId: null };
  }

  const requestedWorkspaceId = initialWorkspaceId ?? selection.workspaceId;
  const restored = resolveWorkspaceForRoute(project, selection, requestedWorkspaceId);
  return {
    projectId: project.id,
    workspaceId: restored?.id ?? "",
    requestedWorkspaceId: requestedWorkspaceId ?? restored?.id ?? null,
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

function submissionUnavailableReason(
  project: SidebarProjectNode | null,
  workspace: SidebarWorkspaceNode | null,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (!project) return t("layout.sidebar.newSession.requireProject");
  if (project.loadState !== "ready") return t("layout.sidebar.newSession.requireReadyProject");
  if (!workspace) return t("layout.sidebar.newSession.requireWorkspace");
  if (workspace.workspaceKind === "orphan") {
    return t("layout.sidebar.newSession.unsupportedWorkspace");
  }
  if (!["project", "standalone", "issue", "parallel"].includes(workspace.workspaceKind)) {
    return t("layout.sidebar.newSession.unsupportedWorkspace");
  }
  if (!workspace.inventory?.path?.startsWith("/")) {
    return t("layout.sidebar.newSession.missingWorkspacePath");
  }
  if (
    (workspace.workspaceKind === "issue" || workspace.workspaceKind === "parallel") &&
    !workspace.issueIdentifier?.trim()
  ) {
    return t("layout.sidebar.newSession.missingIssue");
  }
  return null;
}

function projectRepos(project: SidebarProjectNode) {
  const main = [...project.workspaces, ...project.overflowWorkspaces].find(
    (workspace) => workspace.workspaceKind === "project" && workspace.inventory,
  );
  return main?.inventory?.repos ?? [];
}
