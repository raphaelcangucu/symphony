import { FileText, GitBranch, MessagesSquare, ScrollText, TerminalSquare, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { DevEnvPanel } from "@/components/devenv/DevEnvPanel";
import { LoadDefaultMenu } from "@/components/projects/LoadDefaultMenu";
import { ProjectAgentSelect } from "@/components/projects/ProjectAgentSelect";
import { ProjectTelegramIntegrationCard } from "@/components/projects/ProjectTelegramIntegrationCard";
import { RepositoriesSection } from "@/components/projects/config/RepositoriesSection";
import { TrackerSourceFields } from "@/components/projects/TrackerSourceFields";
import { WorkflowMarkdownEditor } from "@/components/projects/WorkflowMarkdownEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { orderStepsByRepository } from "@/lib/devEnvGroups";
import { initialWorkflowMarkdown } from "@/lib/workflowMarkdown";
import { readAgentKind, writeAgentKind } from "@/lib/workflowFrontMatter";
import { buildWarmUpBootstrapPrompt, stashProjectAssistantHandoff } from "@/lib/previewAssistantHandoff";
import { assistantPath, DEFAULT_PROJECT_SETTINGS_TAB, type ProjectSettingsTab } from "@/lib/workspaceRoutes";
import { listDevEnvSteps, saveDevEnvSteps } from "@/services/devEnv";
import { fetchSettings } from "@/services/settings";
import { updateProject, updateProjectRepositories, updateProjectSetup } from "@/services/projects";
import type { DevEnvStep } from "@/types/devEnv";
import type { AgentKind } from "@/types/issue";
import type { Project, TrackerKind } from "@/types/project";
import type { WorkspaceRepository } from "@/types/repository";

interface SectionDef {
  id: ProjectSettingsTab;
  icon: LucideIcon;
}

const SECTION_DEFS: readonly SectionDef[] = [
  { id: "general", icon: FileText },
  { id: "tracker", icon: GitBranch },
  { id: "workflow", icon: ScrollText },
  { id: "dev", icon: TerminalSquare },
  { id: "integrations", icon: MessagesSquare },
] as const;

function SectionHeading({ id }: { id: ProjectSettingsTab }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold tracking-tight">{t(`project.config.sections.${id}.title`)}</h2>
      <p className="text-sm text-muted-foreground">{t(`project.config.sections.${id}.description`)}</p>
    </div>
  );
}

interface ProjectConfigEditorProps {
  project: Project;
  onSaved: (project: Project) => void;
  onCancel?: () => void;
  activeTab?: ProjectSettingsTab;
  onTabChange?: (tab: ProjectSettingsTab) => void;
}

export function ProjectConfigEditor({ project, onSaved, onCancel, activeTab, onTabChange }: ProjectConfigEditorProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [internalTab, setInternalTab] = useState<ProjectSettingsTab>(activeTab ?? DEFAULT_PROJECT_SETTINGS_TAB);
  const currentTab = activeTab ?? internalTab;

  function handlePrepareEnv() {
    stashProjectAssistantHandoff({
      projectSlug: project.slug,
      message: buildWarmUpBootstrapPrompt(project.slug),
      createdAt: Date.now(),
    });
    navigate(assistantPath(project.slug));
  }

  function handleTabChange(next: string) {
    const tab = next as ProjectSettingsTab;
    setInternalTab(tab);
    onTabChange?.(tab);
  }

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [trackerKind, setTrackerKind] = useState<TrackerKind>(project.tracker.kind);
  const [trackerConfig, setTrackerConfig] = useState<Record<string, unknown>>(project.tracker.config);
  const [validationCommands, setValidationCommands] = useState((project.setup?.validationCommands ?? []).join("\n"));
  const [workflowMarkdown, setWorkflowMarkdown] = useState(() =>
    initialWorkflowMarkdown(project.setup?.workflowMarkdown, project.workflowStatuses ?? []),
  );
  const [repositories, setRepositories] = useState<WorkspaceRepository[]>(() => project.repositories ?? []);
  const initialRepositoriesKey = useMemo(() => JSON.stringify(project.repositories ?? []), [project]);
  const [devSteps, setDevSteps] = useState<DevEnvStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [userDefaultAgent, setUserDefaultAgent] = useState<AgentKind>("codex");

  useEffect(() => {
    let cancelled = false;
    void listDevEnvSteps(project.slug)
      .then((loaded) => {
        // Don't clobber unsaved edits made before the initial load resolved.
        if (!cancelled) setDevSteps((current) => current ?? loaded);
      })
      .catch((cause) => {
        if (!cancelled) toast.error(cause instanceof Error ? cause.message : t("project.config.toasts.devEnvLoadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [project.slug, t]);
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

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error(t("project.config.toasts.nameRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await updateProject(project.slug, {
        name: trimmedName,
        description: description.trim() || null,
        tracker: { kind: trackerKind, config: trackerKind === "local" ? {} : trackerConfig },
      });
      if (JSON.stringify(repositories) !== initialRepositoriesKey) {
        await updateProjectRepositories(project.slug, repositories);
      }
      const saved = await updateProjectSetup(project.slug, {
        workflowMarkdown: workflowMarkdown.trim(),
        validationCommands: validationCommands
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      if (devSteps !== null) {
        const persisted = await saveDevEnvSteps(project.slug, orderStepsByRepository(devSteps, repositories));
        setDevSteps(persisted);
      }
      onSaved(saved);
      toast.success(t("project.config.toasts.saved"));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("project.config.toasts.saveFailed");
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive whitespace-pre-wrap">
          {error}
        </p>
      ) : null}

      <Tabs
        value={currentTab}
        onValueChange={handleTabChange}
        orientation="vertical"
        className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10"
      >
        <TabsList className="flex h-auto flex-col items-stretch gap-1 self-start bg-transparent p-0 md:sticky md:top-6">
          {SECTION_DEFS.map(({ id, icon: Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {t(`project.config.sections.${id}.label`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-w-0">
          <TabsContent value="general" className="mt-0 space-y-6">
            <SectionHeading id="general" />
            <Card>
              <CardContent className="space-y-5 pt-6">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t("project.config.name")}</span>
                  <Input value={name} onChange={(event) => setName(event.target.value)} aria-label={t("project.config.name")} />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t("project.config.description")}</span>
                  <Textarea value={description} onChange={(event) => setDescription(event.target.value)} aria-label={t("project.config.description")} />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t("project.config.validationCommands")}</span>
                  <Textarea
                    value={validationCommands}
                    onChange={(event) => setValidationCommands(event.target.value)}
                    aria-label={t("project.config.validationCommandsAria")}
                  />
                </label>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("project.config.repositories")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-muted-foreground">{t("project.config.repositoriesHint")}</p>
                <RepositoriesSection value={repositories} onChange={setRepositories} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tracker" className="mt-0 space-y-6">
            <SectionHeading id="tracker" />
            <Card>
              <CardContent className="pt-6">
                <TrackerSourceFields
                  slug={project.slug}
                  trackerKind={trackerKind}
                  config={trackerConfig}
                  onKindChange={(kind) => {
                    setTrackerKind(kind);
                    setTrackerConfig(kind === project.tracker.kind ? project.tracker.config : {});
                  }}
                  onConfigChange={(changes) => setTrackerConfig((current) => ({ ...current, ...changes }))}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="workflow" className="mt-0 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <SectionHeading id="workflow" />
              <LoadDefaultMenu
                onLoad={({ validationCommands: commands }) => {
                  if (commands.length > 0) setValidationCommands(commands.join("\n"));
                  toast.message(t("project.config.templateSeedHint"));
                }}
              />
            </div>
            <Card>
              <CardContent className="space-y-4 pt-6">
                <ProjectAgentSelect
                  value={readAgentKind(workflowMarkdown)}
                  effectiveDefault={userDefaultAgent}
                  onChange={(kind) => setWorkflowMarkdown((current) => writeAgentKind(current, kind))}
                />
                <WorkflowMarkdownEditor value={workflowMarkdown} onChange={setWorkflowMarkdown} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dev" className="mt-0 space-y-6">
            <SectionHeading id="dev" />
            <Card>
              <CardContent className="pt-6">
                <DevEnvPanel
                  projectSlug={project.slug}
                  repositories={repositories}
                  steps={devSteps ?? []}
                  onStepsChange={setDevSteps}
                  onPrepareEnv={handlePrepareEnv}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="integrations" className="mt-0 space-y-6">
            <SectionHeading id="integrations" />
            <ProjectTelegramIntegrationCard projectSlug={project.slug} />
          </TabsContent>
        </div>
      </Tabs>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-border/60 bg-background/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/65 sm:-mx-6 sm:px-6">
        <p className="hidden text-xs text-muted-foreground sm:block">{t("project.config.footerHint")}</p>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              {t("project.config.cancel")}
            </Button>
          ) : null}
          <Button type="button" onClick={() => void handleSave()} disabled={submitting}>
            {submitting ? t("project.config.saving") : t("project.config.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
