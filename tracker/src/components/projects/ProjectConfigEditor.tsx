import { useMemo, useState } from "react";
import { toast } from "sonner";

import { KeyValueMapEditor } from "@/components/projects/config/KeyValueMapEditor";
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
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { buildWorkflowConfig, workflowConfigToForm, type WorkflowConfigForm } from "@/lib/workflowConfig";
import { updateProject, updateProjectSetup } from "@/services/projects";
import type { Project, TrackerKind } from "@/types/project";

interface ProjectConfigEditorProps {
  project: Project;
  onSaved: (project: Project) => void;
  onCancel?: () => void;
}

export function ProjectConfigEditor({ project, onSaved, onCancel }: ProjectConfigEditorProps) {
  const statuses = useMemo(() => (project.workflowStatuses ?? []).map((status) => status.name), [project]);

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [trackerKind, setTrackerKind] = useState<TrackerKind>(project.tracker.kind);
  const [trackerConfig, setTrackerConfig] = useState<Record<string, unknown>>(project.tracker.config);
  const [promptTemplate, setPromptTemplate] = useState(project.setup?.promptTemplate ?? "");
  const [validationCommands, setValidationCommands] = useState((project.setup?.validationCommands ?? []).join("\n"));
  const [form, setForm] = useState<WorkflowConfigForm>(() => workflowConfigToForm(project.setup?.workflowConfig));
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
    <div className="space-y-4">
      {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <Tabs defaultValue="general">
        <TabsList className="flex-wrap">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="tracker">Tracker</TabsTrigger>
          <TabsTrigger value="states">States</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="hooks">Hooks</TabsTrigger>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="devtools">Editor &amp; Dev</TabsTrigger>
          <TabsTrigger value="github">GitHub</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 pt-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Name" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Description</span>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} aria-label="Description" />
          </label>
          <div className="space-y-1">
            <p className="text-sm font-medium">Prompt template</p>
            <MarkdownEditor value={promptTemplate} onChange={setPromptTemplate} placeholder="Per-project agent prompt (markdown)" />
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Validation commands (one per line)</span>
            <Textarea
              value={validationCommands}
              onChange={(event) => setValidationCommands(event.target.value)}
              aria-label="Validation commands"
            />
          </label>
        </TabsContent>

        <TabsContent value="tracker" className="space-y-4 pt-4">
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
        </TabsContent>

        <TabsContent value="states" className="space-y-4 pt-4">
          <StateMultiSelect label="Active states" available={statuses} value={form.tracker.active_states} onChange={(v) => patch("tracker", { active_states: v })} />
          <StateMultiSelect label="Dispatch states" available={statuses} value={form.tracker.dispatch_states} onChange={(v) => patch("tracker", { dispatch_states: v })} />
          <StateMultiSelect label="Wait states" available={statuses} value={form.tracker.wait_states} onChange={(v) => patch("tracker", { wait_states: v })} />
          <StateMultiSelect label="Terminal states" available={statuses} value={form.tracker.terminal_states} onChange={(v) => patch("tracker", { terminal_states: v })} />
          <StateMultiSelect label="Field states" available={statuses} value={form.tracker.field_states} onChange={(v) => patch("tracker", { field_states: v })} />
        </TabsContent>

        <TabsContent value="agent" className="space-y-4 pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            {AGENT_SCALAR_FIELDS.map((descriptor) => (
              <ScalarField
                key={descriptor.key}
                descriptor={descriptor}
                value={form.agent[descriptor.key as keyof WorkflowConfigForm["agent"]] as number | undefined}
                onChange={(value) => patch("agent", { [descriptor.key]: value } as Partial<WorkflowConfigForm["agent"]>)}
              />
            ))}
          </div>
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
        </TabsContent>

        <TabsContent value="hooks" className="space-y-4 pt-4">
          {HOOK_FIELDS.map((hook) => (
            <label key={hook} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{hook}</span>
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
        </TabsContent>

        <TabsContent value="workspace" className="space-y-4 pt-4">
          <ScalarField
            descriptor={{ key: "root", label: "Workspace root", kind: "string", placeholder: "/path/to/workspaces" }}
            value={form.workspace.root}
            onChange={(value) => patch("workspace", { root: (value as string) ?? "" })}
          />
        </TabsContent>

        <TabsContent value="devtools" className="space-y-6 pt-4">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Editor</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {EDITOR_SCALAR_FIELDS.map((descriptor) => (
                <ScalarField
                  key={descriptor.key}
                  descriptor={descriptor}
                  value={form.editor[descriptor.key as keyof WorkflowConfigForm["editor"]] as never}
                  onChange={(value) => patch("editor", { [descriptor.key]: value } as Partial<WorkflowConfigForm["editor"]>)}
                />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Dev server</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {DEV_SERVER_SCALAR_FIELDS.map((descriptor) => (
                <ScalarField
                  key={descriptor.key}
                  descriptor={descriptor}
                  value={form.dev_server[descriptor.key as keyof WorkflowConfigForm["dev_server"]] as never}
                  onChange={(value) => patch("dev_server", { [descriptor.key]: value } as Partial<WorkflowConfigForm["dev_server"]>)}
                />
              ))}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Port range (comma-separated)</span>
              <Input
                value={form.dev_server.port_range}
                onChange={(event) => patch("dev_server", { port_range: event.target.value })}
                aria-label="Port range"
                placeholder="4100, 4101, 4102"
              />
            </label>
            <div className="space-y-1">
              <p className="text-sm font-medium">Auto-start on</p>
              <div className="flex gap-3">
                {DEV_SERVER_AUTO_START_OPTIONS.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.dev_server.auto_start_on.includes(option)}
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
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Public tunnel</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {PUBLIC_TUNNEL_SCALAR_FIELDS.map((descriptor) => (
                <ScalarField
                  key={descriptor.key}
                  descriptor={descriptor}
                  value={form.public_tunnel[descriptor.key as keyof WorkflowConfigForm["public_tunnel"]] as never}
                  onChange={(value) => patch("public_tunnel", { [descriptor.key]: value } as Partial<WorkflowConfigForm["public_tunnel"]>)}
                />
              ))}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="github" className="space-y-4 pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            {GITHUB_SCALAR_FIELDS.map((descriptor) => (
              <ScalarField
                key={descriptor.key}
                descriptor={descriptor}
                value={form.github[descriptor.key as keyof WorkflowConfigForm["github"]] as number | undefined}
                onChange={(value) => patch("github", { [descriptor.key]: value } as Partial<WorkflowConfigForm["github"]>)}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2">
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
  );
}
