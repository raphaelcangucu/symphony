import { Plus, RefreshCw } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitHubProjectPicker } from "@/components/projects/GitHubProjectPicker";
import { JiraTrackerFields } from "@/components/projects/JiraTrackerFields";
import { LinearProjectPicker } from "@/components/projects/LinearProjectPicker";
import { ProjectAgentSelect } from "@/components/projects/ProjectAgentSelect";
import { TrackerSourcePicker } from "@/components/projects/TrackerSourcePicker";
import { defaultWorkspacePath, inferRole, sanitizeWorkspaceSegment } from "@/lib/workspaceRepositories";
import { githubProjectBoardUrl } from "@/lib/projectTrackerUrl";
import { writeAgentKind } from "@/lib/workflowFrontMatter";
import { projectSettingsPath } from "@/lib/workspaceRoutes";
import { createWorkspaceProject } from "@/services/projects";
import { listGitHubOwners, listGitHubRepositories, scanRepositories, suggestWorkspaceSetup } from "@/services/projectSetup";
import { fetchSettings } from "@/services/settings";
import { instantiateTemplate, listTemplates } from "@/services/templates";
import type { AgentKind } from "@/types/issue";
import type { WorkspaceSuggestion } from "@/types/project-setup";
import type { GitHubOwner, RepositoryScan, WorkspaceRepository } from "@/types/repository";
import type { Project, TrackerKind } from "@/types/project";
import type { WorkspaceTemplate } from "@/types/template";

type WizardTab = "template" | "scratch";

interface ProjectWorkspaceWizardProps {
  onCreated?: (project: Project) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ProjectWorkspaceWizard({ onCreated, open: controlledOpen, onOpenChange }: ProjectWorkspaceWizardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const [activeTab, setActiveTab] = useState<WizardTab>("scratch");
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkspaceTemplate | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesLoadAttempted, setTemplatesLoadAttempted] = useState(false);
  const [trackerKind, setTrackerKind] = useState<TrackerKind>("local");
  const [remoteConfig, setRemoteConfig] = useState<Record<string, unknown> | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [owner, setOwner] = useState("");
  const [owners, setOwners] = useState<GitHubOwner[]>([]);
  const [repositories, setRepositories] = useState<WorkspaceRepository[]>([]);
  const [selectedRepositories, setSelectedRepositories] = useState<WorkspaceRepository[]>([]);
  const [editingScanPaths, setEditingScanPaths] = useState<Record<string, boolean>>({});
  const [scans, setScans] = useState<RepositoryScan[]>([]);
  const [suggestion, setSuggestion] = useState<WorkspaceSuggestion | null>(null);
  const [ownersAutoLoadAttempted, setOwnersAutoLoadAttempted] = useState(false);
  const [loadingOwners, setLoadingOwners] = useState(false);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [buildingSuggestion, setBuildingSuggestion] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [userDefaultAgent, setUserDefaultAgent] = useState<AgentKind>("codex");
  const [projectAgent, setProjectAgent] = useState<AgentKind | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchSettings()
      .then((s) => {
        if (!cancelled) setUserDefaultAgent(s.agents.default_agent_kind);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open || owners.length > 0 || loadingOwners || ownersAutoLoadAttempted) return;
    setOwnersAutoLoadAttempted(true);
    void handleLoadOwners();
  }, [loadingOwners, open, owners.length, ownersAutoLoadAttempted]);

  useEffect(() => {
    if (!open || loadingTemplates || templatesLoadAttempted) return;
    setTemplatesLoadAttempted(true);
    void handleLoadTemplates();
  }, [loadingTemplates, open, templatesLoadAttempted]);

  function setOpen(nextOpen: boolean) {
    if (!isControlled) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!nextOpen) {
      setOwnersAutoLoadAttempted(false);
      setTemplatesLoadAttempted(false);
    }
  }

  async function handleLoadTemplates() {
    setLoadingTemplates(true);
    try {
      const items = (await listTemplates()) ?? [];
      setTemplates(items);
      setActiveTab(items.length > 0 ? "template" : "scratch");
    } catch (cause) {
      setActiveTab("scratch");
      toast.error(cause instanceof Error ? cause.message : t("project.wizard.loadTemplatesFailed"));
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function handleLoadOwners() {
    setLoadingOwners(true);
    try {
      setOwners(await listGitHubOwners());
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.wizard.loadOrgsFailed"));
    } finally {
      setLoadingOwners(false);
    }
  }

  async function handleSelectOwner(nextOwner: GitHubOwner) {
    setOwner(nextOwner.login);
    setRepositories([]);
    setSelectedRepositories([]);
    setEditingScanPaths({});
    setScans([]);
    setSuggestion(null);
    await handleLoadRepositories(nextOwner.login);
  }

  async function handleLoadRepositories(ownerLogin = owner) {
    const trimmedOwner = ownerLogin.trim();
    if (!trimmedOwner) return;

    setLoadingRepositories(true);
    try {
      const items = await listGitHubRepositories(trimmedOwner);
      setRepositories(items.map(withRepositoryDefaults));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.wizard.loadReposFailed"));
    } finally {
      setLoadingRepositories(false);
    }
  }

  function toggleRepository(repository: WorkspaceRepository) {
    setSuggestion(null);
    setScans([]);
    const wasSelected = selectedRepositories.some((item) => item.fullName === repository.fullName);
    if (wasSelected) {
      setEditingScanPaths((current) => {
        const remaining = { ...current };
        delete remaining[repository.fullName];
        return remaining;
      });
    }
    setSelectedRepositories((current) => {
      if (current.some((item) => item.fullName === repository.fullName)) {
        return current.filter((item) => item.fullName !== repository.fullName);
      }

      return [...current, repositoryWithProjectPath(repository, slug)];
    });
  }

  function updateRepository(fullName: string, changes: Partial<WorkspaceRepository>) {
    setSuggestion(null);
    setSelectedRepositories((current) =>
      current.map((repository) => (repository.fullName === fullName ? { ...repository, ...changes } : repository)),
    );
  }

  function handleEditScanPath(repository: WorkspaceRepository) {
    setSuggestion(null);
    setScans([]);
    setEditingScanPaths((current) => ({ ...current, [repository.fullName]: true }));
    setSelectedRepositories((current) =>
      current.map((item) => {
        if (item.fullName !== repository.fullName || item.localPath?.trim()) return item;
        return { ...item, localPath: item.suggestedLocalPath ?? "" };
      }),
    );
  }

  async function handleScanAndSuggest() {
    if (selectedRepositories.length === 0) return;

    setBuildingSuggestion(true);
    try {
      const repositoriesForSuggestion = repositoriesForWorkspaceProject(selectedRepositories, slug);
      const nextScans = await scanRepositories(
        repositoriesForSuggestion
          .filter((repository) => repository.localPath?.trim())
          .map((repository) => ({
            localPath: repository.localPath ?? "",
            workspacePath: repository.workspacePath,
          })),
      );
      const nextSuggestion = await suggestWorkspaceSetup({ repositories: repositoriesForSuggestion, scans: nextScans });
      setScans(nextScans);
      setSuggestion(nextSuggestion);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.wizard.suggestFailed"));
    } finally {
      setBuildingSuggestion(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (trackerKind !== "local") {
      if (!remoteConfig) {
        toast.error(t("project.wizard.selectRemoteFirst"));
        return;
      }

      setSubmitting(true);
      try {
        const project = await createWorkspaceProject({
          name,
          slug,
          description: null,
          workflowStatuses: [],
          repositories: [],
          setup: {},
          tracker: { kind: trackerKind, config: remoteConfig },
        });

        onCreated?.(project);
        reset();
        setOpen(false);
        toast.success(t("project.wizard.connected"));
        navigate(projectSettingsPath(project.slug));
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : t("project.wizard.connectFailed"));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!suggestion) return;

    setSubmitting(true);
    try {
      const repositoriesForSubmission = repositoriesForWorkspaceProject(selectedRepositories, slug);
      const project = await createWorkspaceProject({
        name,
        slug,
        description: null,
        workflowStatuses: suggestion.workflowStatuses,
        repositories: repositoriesForSubmission,
        setup: {
          workflowMarkdown: projectAgent
            ? writeAgentKind(suggestion.workflowMarkdown ?? "", projectAgent)
            : suggestion.workflowMarkdown,
          validationCommands: suggestion.validationCommands,
          afterCreateHook: suggestion.afterCreateHook,
          scanSummary: suggestion.scanSummary,
        },
      });

      onCreated?.(project);
      reset();
      setOpen(false);
      toast.success(t("project.wizard.created"));
      navigate(projectSettingsPath(project.slug));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.wizard.createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleInstantiateTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedTemplate) {
      toast.error(t("project.wizard.selectTemplate"));
      return;
    }

    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedName || !trimmedSlug) {
      toast.error(t("project.wizard.nameSlugRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const project = await instantiateTemplate(selectedTemplate.slug, {
        name: trimmedName,
        slug: trimmedSlug,
        tracker: { kind: trackerKind, config: remoteConfig ?? {} },
      });

      onCreated?.(project);
      reset();
      setOpen(false);
      toast.success(t("project.wizard.createdFromTemplate"));
      navigate(projectSettingsPath(project.slug));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.wizard.createFromTemplateFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setSelectedTemplate(null);
    setTrackerKind("local");
    setRemoteConfig(null);
    setName("");
    setSlug("");
    setOwner("");
    setRepositories([]);
    setSelectedRepositories([]);
    setEditingScanPaths({});
    setScans([]);
    setSuggestion(null);
    setProjectAgent(null);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {isControlled ? null : (
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus className="h-4 w-4" />
            {t("project.wizard.trigger")}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("project.wizard.title")}</DialogTitle>
          <DialogDescription>{t("project.wizard.description")}</DialogDescription>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as WizardTab)}>
          <TabsList>
            <TabsTrigger value="template">{t("project.wizard.tabTemplate")}</TabsTrigger>
            <TabsTrigger value="scratch">{t("project.wizard.tabScratch")}</TabsTrigger>
          </TabsList>

          <TabsContent value="template">
            <form className="space-y-5" onSubmit={handleInstantiateTemplate}>
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("project.wizard.templateLabel")}</p>
                <p className="text-xs text-muted-foreground">{t("project.wizard.templateHint")}</p>
                {templates.length > 0 ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {templates.map((template) => (
                      <button
                        type="button"
                        key={template.id}
                        onClick={() => setSelectedTemplate(template)}
                        className={`flex flex-col gap-1 rounded-md border p-3 text-left transition hover:bg-muted/50 ${
                          selectedTemplate?.id === template.id ? "border-primary bg-muted/40" : ""
                        }`}
                      >
                        <span className="truncate text-sm font-medium">{template.name}</span>
                        {template.description ? (
                          <span className="block truncate text-xs text-muted-foreground">{template.description}</span>
                        ) : (
                          <span className="block truncate text-xs text-muted-foreground">
                            {t("project.wizard.templateRepoCount", { count: template.repositories.length })}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                    {loadingTemplates ? t("project.wizard.loadingTemplates") : t("project.wizard.noTemplates")}
                  </p>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("project.wizard.projectNamePlaceholder")} />
                <Input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder={t("project.wizard.projectSlugPlaceholder")} />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  {t("project.wizard.cancel")}
                </Button>
                <Button type="submit" disabled={submitting || !selectedTemplate || !name.trim() || !slug.trim()}>
                  {submitting ? t("project.wizard.creating") : t("project.wizard.createFromTemplate")}
                </Button>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="scratch">
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("project.wizard.trackerSource")}</p>
            <TrackerSourcePicker
              value={trackerKind}
              onChange={(kind) => {
                setTrackerKind(kind);
                setRemoteConfig(null);
              }}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("project.wizard.projectNamePlaceholder")} autoFocus />
            <Input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder={t("project.wizard.projectSlugPlaceholder")} />
          </div>

          {trackerKind === "github" ? (
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{t("project.tracker.github.title")}</p>
                <p className="text-xs text-muted-foreground">{t("project.tracker.github.descriptionWizard")}</p>
              </div>
              <GitHubProjectPicker
                onSelect={(project) =>
                  setRemoteConfig({
                    repo: project.repoNameWithOwner ?? "",
                    project_id: project.id,
                    project_number: project.number,
                    project_url: githubProjectBoardUrl(project),
                    owner_kind: project.owner.kind,
                    status_field: "Symphony State",
                  })
                }
              />
            </div>
          ) : null}

          {trackerKind === "linear" ? (
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{t("project.tracker.linear.title")}</p>
                <p className="text-xs text-muted-foreground">{t("project.tracker.linear.description")}</p>
              </div>
              <LinearProjectPicker
                onSelect={(project) =>
                  setRemoteConfig({
                    project_id: project.id,
                    team_id: project.team.id,
                    project_slug: project.slugId,
                  })
                }
              />
            </div>
          ) : null}

          {trackerKind === "jira" ? (
            <JiraTrackerFields
              config={remoteConfig ?? {}}
              onConfigChange={(changes) => setRemoteConfig((current) => ({ ...(current ?? {}), ...changes }))}
            />
          ) : null}

          {trackerKind === "local" ? (
          <>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t("project.wizard.organization.title")}</p>
                <p className="text-xs text-muted-foreground">{t("project.wizard.organization.description")}</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={handleLoadOwners} disabled={loadingOwners}>
                <RefreshCw className="h-4 w-4" />
                {loadingOwners ? t("project.wizard.loading") : t("project.wizard.refresh")}
              </Button>
            </div>

            {owners.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {owners.map((githubOwner) => (
                  <button
                    type="button"
                    key={`${githubOwner.kind}-${githubOwner.login}`}
                    onClick={() => void handleSelectOwner(githubOwner)}
                    className={`flex items-center gap-3 rounded-md border p-3 text-left transition hover:bg-muted/50 ${
                      owner === githubOwner.login ? "border-primary bg-muted/40" : ""
                    }`}
                  >
                    <RepositoryIdentityAvatar
                      avatarUrl={githubOwner.avatarUrl}
                      label={githubOwner.name || githubOwner.login}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{githubOwner.name || githubOwner.login}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {githubOwner.login} ·{" "}
                        {githubOwner.kind === "organization"
                          ? t("project.wizard.organization.kindOrganization")
                          : t("project.wizard.organization.kindUser")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                {loadingOwners ? t("project.wizard.loadingOrganizations") : t("project.wizard.noOrganizations")}
              </p>
            )}

            {owner ? (
              <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-sm">
                <span>
                  {t("project.wizard.organization.selected")}: <strong>{owner}</strong>
                </span>
                <Button type="button" variant="secondary" size="sm" onClick={() => handleLoadRepositories()} disabled={loadingRepositories}>
                  {loadingRepositories ? t("project.wizard.loading") : t("project.wizard.reloadRepositories")}
                </Button>
              </div>
            ) : null}
          </div>

          {repositories.length > 0 ? (
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{t("project.wizard.repositories.title")}</p>
                <p className="text-xs text-muted-foreground">{t("project.wizard.repositories.description")}</p>
              </div>
              {repositories.map((repository) => {
                const selected = selectedRepositories.find((item) => item.fullName === repository.fullName);
                const workspacePath = projectWorkspacePath(repository, slug);
                const scanPathInputId = `scan-path-${domId(repository.fullName)}`;
                const isEditingScanPath = selected ? Boolean(editingScanPaths[selected.fullName]) : false;
                return (
                  <div key={repository.fullName} className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)]">
                    <label className="flex min-w-0 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(selected)}
                        onChange={() => toggleRepository(repository)}
                      />
                      <RepositoryIdentityAvatar avatarUrl={repository.avatarUrl} label={repository.fullName} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">{repository.fullName}</span>
                          {repository.private ? <Badge variant="muted">{t("project.wizard.repositories.private")}</Badge> : null}
                        </span>
                        {repository.description ? (
                          <span className="block truncate text-xs text-muted-foreground">{repository.description}</span>
                        ) : null}
                      </span>
                    </label>
                    {selected ? (
                      <div className="space-y-2">
                        <div className="rounded-md bg-muted/40 px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {t("project.wizard.repositories.workspacePath")}
                          </p>
                          <code className="break-all text-xs text-foreground">{workspacePath}</code>
                        </div>
                        {isEditingScanPath ? (
                          <div className="space-y-1">
                            <label htmlFor={scanPathInputId} className="text-xs font-medium">
                              {t("project.wizard.repositories.scanPathLabel", { repo: repository.fullName })}
                            </label>
                            <Input
                              id={scanPathInputId}
                              value={selected.localPath ?? ""}
                              onChange={(event) => updateRepository(repository.fullName, { localPath: event.target.value })}
                              placeholder={t("project.wizard.repositories.scanPathPlaceholder", { path: workspacePath })}
                            />
                            <p className="text-xs text-muted-foreground">{t("project.wizard.repositories.scanPathHint")}</p>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="justify-start px-0 text-xs text-muted-foreground"
                            aria-label={t("project.wizard.repositories.editScanPathAria", { repo: repository.fullName })}
                            onClick={() => handleEditScanPath(selected)}
                          >
                            {t("project.wizard.repositories.editScanPath")}
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="secondary" onClick={handleScanAndSuggest} disabled={buildingSuggestion || selectedRepositories.length === 0}>
              {buildingSuggestion ? t("project.wizard.scanning") : t("project.wizard.scanAndSuggest")}
            </Button>
            {scans.length > 0 ? (
              <span className="text-sm text-muted-foreground">{t("project.wizard.scanCount", { count: scans.length })}</span>
            ) : null}
          </div>

          {suggestion ? (
            <div className="space-y-3">
              <ProjectAgentSelect
                value={projectAgent}
                model={null}
                effort={null}
                effectiveDefault={userDefaultAgent}
                onChange={({ agent }) => setProjectAgent(agent)}
              />
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{t("project.wizard.suggestedSetup")}</p>
                <p>{suggestion.validationCommands.join(", ")}</p>
                <pre className="max-h-32 overflow-auto rounded bg-background p-2 text-xs">{suggestion.afterCreateHook}</pre>
              </div>
            </div>
          ) : null}
          </>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("project.wizard.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={submitting || (trackerKind === "local" ? !suggestion : !remoteConfig)}
            >
              {submitButtonLabel(trackerKind, submitting, t)}
            </Button>
          </div>
        </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function submitButtonLabel(trackerKind: TrackerKind, submitting: boolean, t: (key: string) => string): string {
  if (trackerKind === "local") {
    return submitting ? t("project.wizard.creating") : t("project.wizard.createWorkspaceProject");
  }
  return submitting ? t("project.wizard.connecting") : t("project.wizard.connectProject");
}

function withRepositoryDefaults(repository: WorkspaceRepository): WorkspaceRepository {
  const fallbackName = repository.name ?? repository.fullName.split("/").pop() ?? "repository";
  const suggestedLocalPath = repository.suggestedLocalPath ?? null;
  const existingLocalPath = repository.localPath?.trim();
  const localPath = existingLocalPath && existingLocalPath !== suggestedLocalPath ? existingLocalPath : null;
  return {
    ...repository,
    selectedBranch: repository.selectedBranch ?? repository.defaultBranch ?? "main",
    suggestedLocalPath,
    localPath,
    workspacePath: repository.workspacePath || defaultWorkspacePath(fallbackName),
    role: repository.role || inferRole(fallbackName),
  };
}

function repositoriesForWorkspaceProject(repositories: WorkspaceRepository[], projectSlug: string): WorkspaceRepository[] {
  return repositories.map((repository) => repositoryWithProjectPath(repository, projectSlug));
}

function repositoryWithProjectPath(repository: WorkspaceRepository, projectSlug: string): WorkspaceRepository {
  return {
    ...repository,
    localPath: repository.localPath?.trim() || null,
    workspacePath: projectWorkspacePath(repository, projectSlug),
  };
}

function projectWorkspacePath(repository: WorkspaceRepository, projectSlug: string): string {
  const repositoryName = repository.name ?? repository.fullName.split("/").pop() ?? repository.workspacePath ?? "repository";
  const repositoryPath = defaultWorkspacePath(repositoryName);
  const projectPath = sanitizeWorkspaceSegment(projectSlug);
  return projectPath ? `${projectPath}/${repositoryPath}` : repositoryPath;
}

function RepositoryIdentityAvatar({ avatarUrl, label }: { avatarUrl?: string | null; label: string }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border object-cover" />;
  }

  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold text-white"
      style={{ backgroundColor: fallbackAvatarColor(label) }}
      aria-hidden="true"
    >
      {initialsFor(label)}
    </span>
  );
}

function initialsFor(label: string): string {
  const parts = label.split(/[/\s._-]+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "R";
}

function fallbackAvatarColor(label: string): string {
  let hash = 0;
  for (const char of label) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }

  return `hsl(${hash} 70% 40%)`;
}

function domId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}
