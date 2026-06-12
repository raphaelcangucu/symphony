import { FileText, GitBranch, ScrollText, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { LoadDefaultMenu } from "@/components/projects/LoadDefaultMenu";
import { ProjectAgentSelect } from "@/components/projects/ProjectAgentSelect";
import { RepositoriesSection } from "@/components/projects/config/RepositoriesSection";
import { TrackerSourceFields } from "@/components/projects/TrackerSourceFields";
import { WorkflowMarkdownEditor } from "@/components/projects/WorkflowMarkdownEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { initialWorkflowMarkdown } from "@/lib/workflowMarkdown";
import { readAgentKind, writeAgentKind } from "@/lib/workflowFrontMatter";
import { DEFAULT_PROJECT_SETTINGS_TAB, type ProjectSettingsTab } from "@/lib/workspaceRoutes";
import { fetchSettings } from "@/services/settings";
import { updateProject, updateProjectRepositories, updateProjectSetup } from "@/services/projects";
import type { AgentKind } from "@/types/issue";
import type { Project, TrackerKind } from "@/types/project";
import type { WorkspaceRepository } from "@/types/repository";

interface SectionMeta {
  id: ProjectSettingsTab;
  label: string;
  icon: LucideIcon;
  title: string;
  description: string;
}

const SECTIONS: readonly SectionMeta[] = [
  {
    id: "general",
    label: "General",
    icon: FileText,
    title: "General",
    description: "Project identity, linked repositories, and validation commands.",
  },
  {
    id: "tracker",
    label: "Tracker",
    icon: GitBranch,
    title: "Tracker source",
    description: "Where issues are read from — the local board, GitHub Projects, Linear, or Jira.",
  },
  {
    id: "workflow",
    label: "Workflow",
    icon: ScrollText,
    title: "Workflow",
    description: "Per-project behavior: board states, agent limits, hooks, Codex/Claude, dev server, and the agent prompt.",
  },
] as const;

function SectionHeading({ id }: { id: ProjectSettingsTab }) {
  const meta = SECTIONS.find((section) => section.id === id);
  if (!meta) return null;
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold tracking-tight">{meta.title}</h2>
      <p className="text-sm text-muted-foreground">{meta.description}</p>
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
  const [internalTab, setInternalTab] = useState<ProjectSettingsTab>(activeTab ?? DEFAULT_PROJECT_SETTINGS_TAB);
  const currentTab = activeTab ?? internalTab;

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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [userDefaultAgent, setUserDefaultAgent] = useState<AgentKind>("codex");
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
      toast.error("Project name is required");
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
      onSaved(saved);
      toast.success("Project configuration saved");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to save project configuration";
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
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none"
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-w-0">
          <TabsContent value="general" className="mt-0 space-y-6">
            <SectionHeading id="general" />
            <Card>
              <CardContent className="space-y-5 pt-6">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Name</span>
                  <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Name" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Description</span>
                  <Textarea value={description} onChange={(event) => setDescription(event.target.value)} aria-label="Description" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Validation commands (one per line)</span>
                  <Textarea
                    value={validationCommands}
                    onChange={(event) => setValidationCommands(event.target.value)}
                    aria-label="Validation commands"
                  />
                </label>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Repositories</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-muted-foreground">
                  Repositories linked to this project. Removing one only unlinks it in Symphony — files on disk are left
                  untouched.
                </p>
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
                  toast.message("Templates only seed validation commands; edit workflow YAML here.");
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
        </div>
      </Tabs>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-border/60 bg-background/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/65 sm:-mx-6 sm:px-6">
        <p className="hidden text-xs text-muted-foreground sm:block">Changes apply to this project only.</p>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          ) : null}
          <Button type="button" onClick={() => void handleSave()} disabled={submitting}>
            {submitting ? "Saving..." : "Save configuration"}
          </Button>
        </div>
      </div>
    </div>
  );
}
