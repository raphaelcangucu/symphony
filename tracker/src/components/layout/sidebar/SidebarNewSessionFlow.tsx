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
import type { SidebarProjectNode, SidebarWorkspaceNode } from "@/types/sidebar";

const MAX_TITLE_LENGTH = 160;
const SUPPORTED_AGENT_KINDS = ["codex", "claude", "cursor"] as const;
type SupportedAgentKind = (typeof SUPPORTED_AGENT_KINDS)[number];

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
  const [submitting, setSubmitting] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const loadedRequests = useRef(new Set<string>());
  const successDelivered = useRef(false);
  const submissionInFlight = useRef(false);
  const initializedSelectionKey = useRef<string | null>(null);

  const selectedProject = projects.find((project) => project.id === projectId) ?? null;
  const workspaces = selectedProject
    ? [...selectedProject.workspaces, ...selectedProject.overflowWorkspaces]
    : [];
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === workspaceId) ?? null;

  useEffect(() => {
    if (!open) {
      setProjectId("");
      setWorkspaceId("");
      setTitle("");
      setAgentKind("");
      setSubmitting(false);
      setServiceError(null);
      setNewWorkspaceOpen(false);
      loadedRequests.current.clear();
      successDelivered.current = false;
      submissionInFlight.current = false;
      initializedSelectionKey.current = null;
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
    const initial = resolveInitialSelection(
      projects,
      selection,
      initialProjectId,
      initialWorkspaceId,
    );
    setProjectId(initial.projectId);
    setWorkspaceId(initial.workspaceId);
    setServiceError(null);
    successDelivered.current = false;
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
    if (!open || !projectId) return;
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      setProjectId("");
      setWorkspaceId("");
      return;
    }
    if (workspaceId) {
      const availableWorkspaces = [...project.workspaces, ...project.overflowWorkspaces];
      const exists = availableWorkspaces.some(
        (workspace) => workspace.id === workspaceId,
      );
      if (!exists) {
        const requestedWorkspaceId = initialWorkspaceId ?? selection.workspaceId;
        setWorkspaceId(
          requestedWorkspaceId &&
            availableWorkspaces.some(({ id }) => id === requestedWorkspaceId)
            ? requestedWorkspaceId
            : "",
        );
      }
    }
  }, [
    initialWorkspaceId,
    open,
    projectId,
    projects,
    selection.workspaceId,
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
    setProjectId(nextProjectId);
    setWorkspaceId("");
    setServiceError(null);
  }

  async function submit() {
    if (
      submissionInFlight.current ||
      unavailableReason ||
      !selectedProject ||
      !selectedWorkspace
    ) {
      return;
    }
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
      complete(selectedProject.projectSlug, thread.id);
    } catch (cause) {
      setServiceError(
        cause instanceof Error
          ? cause.message
          : t("layout.sidebar.newSession.serviceError"),
      );
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  }

  function complete(projectSlug: string, threadId: number) {
    if (successDelivered.current) return;
    successDelivered.current = true;
    onOpenChange(false);
    onCreated(projectSlug, threadId);
  }

  function retryProject() {
    if (!selectedProject || !ensureProjectExpanded) return;
    loadedRequests.current.delete(selectedProject.id);
    loadedRequests.current.add(selectedProject.id);
    void ensureProjectExpanded(selectedProject.id);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("layout.sidebar.newSession.title")}</DialogTitle>
            <DialogDescription>
              {t("layout.sidebar.newSession.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="grid gap-1 text-sm">
              <span>{t("layout.sidebar.newSession.project")}</span>
              <select
                aria-label={t("layout.sidebar.newSession.project")}
                className="h-9 rounded-md border bg-background px-2"
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
                className="h-9 rounded-md border bg-background px-2"
                value={workspaceId}
                disabled={!selectedProject || selectedProject.loadState !== "ready" || submitting}
                onChange={(event) => {
                  setWorkspaceId(event.target.value);
                  setServiceError(null);
                }}
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
                className="h-9 rounded-md border bg-background px-2"
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
              <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive">
                <span>{selectedProject.error ?? t("layout.sidebar.newSession.loadError")}</span>
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
              onClick={() => void submit()}
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
          projectRepos={projectRepos(selectedProject)}
          open={newWorkspaceOpen}
          onOpenChange={setNewWorkspaceOpen}
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
): { projectId: string; workspaceId: string } {
  const requestedProjectId = initialProjectId ?? selection.projectSlug ?? "";
  const project =
    projects.find(
      (candidate) =>
        candidate.id === requestedProjectId ||
        candidate.projectSlug === requestedProjectId,
    ) ?? null;
  if (!project) return { projectId: "", workspaceId: "" };

  const workspaces = [...project.workspaces, ...project.overflowWorkspaces];
  const requestedWorkspaceId = initialWorkspaceId ?? selection.workspaceId;
  if (requestedWorkspaceId) {
    const workspace = workspaces.find(({ id }) => id === requestedWorkspaceId);
    return { projectId: project.id, workspaceId: workspace?.id ?? "" };
  }

  if (selection.sessionId) {
    const workspace = workspaces.find((candidate) =>
      [...candidate.sessions, ...candidate.overflowSessions].some(
        (session) => session.id === selection.sessionId,
      ),
    );
    return { projectId: project.id, workspaceId: workspace?.id ?? "" };
  }
  return { projectId: project.id, workspaceId: "" };
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
