import {
  Bot,
  Code2,
  FileText,
  FolderTree,
  Gauge,
  GitBranch,
  ListChecks,
  Server,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { KeyValueMapEditor } from "@/components/projects/config/KeyValueMapEditor";
import { RepositoriesSection } from "@/components/projects/config/RepositoriesSection";
import { ScalarField } from "@/components/projects/config/ScalarField";
import { StateMultiSelect } from "@/components/projects/config/StateMultiSelect";
import {
  AGENT_SCALAR_FIELDS,
  DEV_SERVER_AUTO_START_OPTIONS,
  DEV_SERVER_SCALAR_FIELDS,
  EDITOR_SCALAR_FIELDS,
  GITHUB_SCALAR_FIELDS,
  HOOK_FIELDS,
  PUBLIC_TUNNEL_SCALAR_FIELDS,
} from "@/components/projects/config/sectionFields";
import { TrackerSourceFields } from "@/components/projects/TrackerSourceFields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { buildWorkflowConfig, workflowConfigToForm, type WorkflowConfigForm } from "@/lib/workflowConfig";
import { DEFAULT_PROJECT_SETTINGS_TAB, type ProjectSettingsTab } from "@/lib/workspaceRoutes";
import { updateProject, updateProjectRepositories, updateProjectSetup } from "@/services/projects";
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
    description: "Identity, the per-project agent prompt, and validation commands.",
  },
  {
    id: "tracker",
    label: "Tracker",
    icon: GitBranch,
    title: "Tracker source",
    description: "Where issues are read from — the local board, GitHub Projects, or Linear.",
  },
  {
    id: "states",
    label: "States",
    icon: ListChecks,
    title: "Workflow states",
    description: "Map your board columns to Symphony's orchestration roles.",
  },
  {
    id: "agent",
    label: "Agent",
    icon: Bot,
    title: "Agent",
    description: "Turn limits, concurrency, timeouts, and completion transitions.",
  },
  {
    id: "hooks",
    label: "Hooks",
    icon: Webhook,
    title: "Lifecycle hooks",
    description: "Shell commands run around workspace creation and agent runs.",
  },
  {
    id: "workspace",
    label: "Workspace",
    icon: FolderTree,
    title: "Workspace",
    description: "Where task workspaces are created on the host machine.",
  },
  {
    id: "editor",
    label: "Editor",
    icon: Code2,
    title: "Editor",
    description: "The browser-based code editor (code-server) for task workspaces.",
  },
  {
    id: "dev",
    label: "Dev",
    icon: Server,
    title: "Dev & preview",
    description: "Per-task dev servers and public preview tunnels.",
  },
  {
    id: "github",
    label: "GitHub",
    icon: Gauge,
    title: "GitHub API",
    description: "Rate-limit and retry tuning for GitHub requests.",
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
  const statuses = useMemo(() => (project.workflowStatuses ?? []).map((status) => status.name), [project]);

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
  const [promptTemplate, setPromptTemplate] = useState(project.setup?.promptTemplate ?? "");
  const [validationCommands, setValidationCommands] = useState((project.setup?.validationCommands ?? []).join("\n"));
  const [form, setForm] = useState<WorkflowConfigForm>(() => workflowConfigToForm(project.setup?.workflowConfig));
  const [repositories, setRepositories] = useState<WorkspaceRepository[]>(() => project.repositories ?? []);
  const initialRepositoriesKey = useMemo(() => JSON.stringify(project.repositories ?? []), [project]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function patch<K extends keyof WorkflowConfigForm>(section: K, changes: Partial<WorkflowConfigForm[K]>) {
    setForm((current) => ({ ...current, [section]: { ...current[section], ...changes } }));
  }

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
      // Only replace repositories when they actually changed: the backend replace deletes and re-inserts rows (new ids), so an unconditional call would churn the data on every save.
      if (JSON.stringify(repositories) !== initialRepositoriesKey) {
        await updateProjectRepositories(project.slug, repositories);
      }
      // updateProjectSetup is awaited last because its response is the only one that includes the full project with `setup` (and freshly persisted repositories); we return that as the saved project.
      const saved = await updateProjectSetup(project.slug, {
        promptTemplate,
        validationCommands: validationCommands
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        workflowConfig: buildWorkflowConfig(form),
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
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Prompt template</p>
                  <MarkdownEditor value={promptTemplate} onChange={setPromptTemplate} placeholder="Per-project agent prompt (markdown)" />
                </div>
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

          <TabsContent value="states" className="mt-0 space-y-6">
            <SectionHeading id="states" />
            <Card>
              <CardContent className="space-y-5 pt-6">
                <StateMultiSelect label="Active states" available={statuses} value={form.tracker.active_states} onChange={(v) => patch("tracker", { active_states: v })} />
                <StateMultiSelect label="Dispatch states" available={statuses} value={form.tracker.dispatch_states} onChange={(v) => patch("tracker", { dispatch_states: v })} />
                <StateMultiSelect label="Wait states" available={statuses} value={form.tracker.wait_states} onChange={(v) => patch("tracker", { wait_states: v })} />
                <StateMultiSelect label="Terminal states" available={statuses} value={form.tracker.terminal_states} onChange={(v) => patch("tracker", { terminal_states: v })} />
                <StateMultiSelect label="Field states" available={statuses} value={form.tracker.field_states} onChange={(v) => patch("tracker", { field_states: v })} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="agent" className="mt-0 space-y-6">
            <SectionHeading id="agent" />
            <Card>
              <CardContent className="pt-6">
                <div className="grid gap-4 md:grid-cols-2">
                  {AGENT_SCALAR_FIELDS.map((descriptor) => (
                    <ScalarField
                      key={descriptor.key}
                      descriptor={descriptor}
                      value={form.agent[descriptor.key as keyof WorkflowConfigForm["agent"]] as number | undefined}
                      onChange={(value) => patch("agent", { [descriptor.key]: value } as Partial<WorkflowConfigForm["agent"]>)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-6 pt-6">
                <KeyValueMapEditor
                  label="Completion transitions"
                  description="When the agent completes in a state (key), move the issue to the target state (value)."
                  keyOptions={statuses}
                  valueKind="state"
                  valueOptions={statuses}
                  value={form.agent.completion_transitions}
                  onChange={(value) => patch("agent", { completion_transitions: value as Record<string, string> })}
                />
                <KeyValueMapEditor
                  label="Max concurrent agents by state"
                  keyOptions={statuses}
                  valueKind="number"
                  value={form.agent.max_concurrent_agents_by_state}
                  onChange={(value) => patch("agent", { max_concurrent_agents_by_state: value as Record<string, number> })}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="hooks" className="mt-0 space-y-6">
            <SectionHeading id="hooks" />
            <Card>
              <CardContent className="space-y-5 pt-6">
                {HOOK_FIELDS.map((hook) => (
                  <label key={hook} className="flex flex-col gap-1.5 text-sm">
                    <span className="font-mono text-xs font-medium text-muted-foreground">{hook}</span>
                    <Textarea
                      value={form.hooks[hook] ?? ""}
                      onChange={(event) => patch("hooks", { [hook]: event.target.value } as Partial<WorkflowConfigForm["hooks"]>)}
                      aria-label={hook}
                      className="font-mono text-xs"
                    />
                  </label>
                ))}
                <ScalarField
                  descriptor={{ key: "timeout_ms", label: "Hook timeout (ms)", kind: "number" }}
                  value={form.hooks.timeout_ms}
                  onChange={(value) => patch("hooks", { timeout_ms: value as number | undefined })}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="workspace" className="mt-0 space-y-6">
            <SectionHeading id="workspace" />
            <Card>
              <CardContent className="pt-6">
                <ScalarField
                  descriptor={{ key: "root", label: "Workspace root", kind: "string", placeholder: "/path/to/workspaces" }}
                  value={form.workspace.root}
                  onChange={(value) => patch("workspace", { root: (value as string) ?? "" })}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Repositories</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-muted-foreground">
                  Repositories linked to this project. Removing one only unlinks it in Symphony — files on disk are left
                  untouched. Changes are persisted when you save.
                </p>
                <RepositoriesSection value={repositories} onChange={setRepositories} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="editor" className="mt-0 space-y-6">
            <SectionHeading id="editor" />
            <Card>
              <CardContent className="pt-6">
                <div className="grid gap-4 md:grid-cols-2">
                  {EDITOR_SCALAR_FIELDS.map((descriptor) => (
                    <ScalarField
                      key={descriptor.key}
                      descriptor={descriptor}
                      value={form.editor[descriptor.key as keyof WorkflowConfigForm["editor"]] as never}
                      onChange={(value) => patch("editor", { [descriptor.key]: value } as Partial<WorkflowConfigForm["editor"]>)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dev" className="mt-0 space-y-6">
            <SectionHeading id="dev" />
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Dev server</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {DEV_SERVER_SCALAR_FIELDS.map((descriptor) => (
                    <ScalarField
                      key={descriptor.key}
                      descriptor={descriptor}
                      value={form.dev_server[descriptor.key as keyof WorkflowConfigForm["dev_server"]] as never}
                      onChange={(value) => patch("dev_server", { [descriptor.key]: value } as Partial<WorkflowConfigForm["dev_server"]>)}
                    />
                  ))}
                </div>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Port range (comma-separated)</span>
                  <Input
                    value={form.dev_server.port_range}
                    onChange={(event) => patch("dev_server", { port_range: event.target.value })}
                    aria-label="Port range"
                    placeholder="4100, 4101, 4102"
                  />
                </label>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Auto-start on</p>
                  <div className="flex flex-wrap gap-2">
                    {DEV_SERVER_AUTO_START_OPTIONS.map((option) => {
                      const checked = form.dev_server.auto_start_on.includes(option);
                      return (
                        <label
                          key={option}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                            checked ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={(event) =>
                              patch("dev_server", {
                                auto_start_on: event.target.checked
                                  ? [...form.dev_server.auto_start_on, option]
                                  : form.dev_server.auto_start_on.filter((item) => item !== option),
                              })
                            }
                            aria-label={option}
                          />
                          {option}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Public tunnel</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  {PUBLIC_TUNNEL_SCALAR_FIELDS.map((descriptor) => (
                    <ScalarField
                      key={descriptor.key}
                      descriptor={descriptor}
                      value={form.public_tunnel[descriptor.key as keyof WorkflowConfigForm["public_tunnel"]] as never}
                      onChange={(value) => patch("public_tunnel", { [descriptor.key]: value } as Partial<WorkflowConfigForm["public_tunnel"]>)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="github" className="mt-0 space-y-6">
            <SectionHeading id="github" />
            <Card>
              <CardContent className="pt-6">
                <div className="grid gap-4 md:grid-cols-2">
                  {GITHUB_SCALAR_FIELDS.map((descriptor) => (
                    <ScalarField
                      key={descriptor.key}
                      descriptor={descriptor}
                      value={form.github[descriptor.key as keyof WorkflowConfigForm["github"]] as number | undefined}
                      onChange={(value) => patch("github", { [descriptor.key]: value } as Partial<WorkflowConfigForm["github"]>)}
                    />
                  ))}
                </div>
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
