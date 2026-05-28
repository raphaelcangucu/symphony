import { Download, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  exportTemplate,
  updateTemplate,
  type UpdateTemplateInput,
  type UpdateTemplateRepositoryInput,
} from "@/services/templates";
import type { WorkspaceTemplate } from "@/types/template";

interface TemplateFormProps {
  template: WorkspaceTemplate;
  onSaved?: (template: WorkspaceTemplate) => void;
}

interface RepositoryFields {
  githubFullName: string;
  cloneUrl: string;
  defaultBranch: string;
  workspacePath: string;
  role: string;
}

function toRepositoryFields(repository: WorkspaceTemplate["repositories"][number]): RepositoryFields {
  return {
    githubFullName: repository.githubFullName,
    cloneUrl: repository.cloneUrl,
    defaultBranch: repository.defaultBranch ?? "",
    workspacePath: repository.workspacePath,
    role: repository.role ?? "",
  };
}

function emptyRepository(): RepositoryFields {
  return { githubFullName: "", cloneUrl: "", defaultBranch: "", workspacePath: "", role: "" };
}

function toRepositoryInput(fields: RepositoryFields): UpdateTemplateRepositoryInput {
  return {
    githubFullName: fields.githubFullName.trim(),
    cloneUrl: fields.cloneUrl.trim(),
    defaultBranch: fields.defaultBranch.trim() || null,
    workspacePath: fields.workspacePath.trim(),
    role: fields.role.trim() || null,
  };
}

function parseCommands(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function TemplateForm({ template, onSaved }: TemplateFormProps) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [validationCommands, setValidationCommands] = useState(template.validationCommands.join("\n"));
  const [afterCreateHook, setAfterCreateHook] = useState(template.afterCreateHook ?? "");
  const [promptTemplate, setPromptTemplate] = useState(template.promptTemplate ?? "");
  const [devEnvMarkdown, setDevEnvMarkdown] = useState(template.devEnvMarkdown ?? "");
  const [repositories, setRepositories] = useState<RepositoryFields[]>(template.repositories.map(toRepositoryFields));
  const [submitting, setSubmitting] = useState(false);

  const updateRepository = (index: number, patch: Partial<RepositoryFields>) => {
    setRepositories((current) => current.map((repo, i) => (i === index ? { ...repo, ...patch } : repo)));
  };

  const addRepository = () => {
    setRepositories((current) => [...current, emptyRepository()]);
  };

  const removeRepository = (index: number) => {
    setRepositories((current) => current.filter((_, i) => i !== index));
  };

  const handleExport = async () => {
    try {
      const yaml = await exportTemplate(template.slug);
      const blob = new Blob([yaml], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${template.slug}.yaml`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to export template");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);

    const input: UpdateTemplateInput = {
      name: name.trim(),
      description: description.trim() || null,
      validationCommands: parseCommands(validationCommands),
      afterCreateHook: afterCreateHook.trim() || null,
      promptTemplate: promptTemplate.trim() || null,
      devEnvMarkdown: devEnvMarkdown.trim() || null,
      repositories: repositories.map(toRepositoryInput),
    };

    try {
      const saved = await updateTemplate(template.slug, input);
      onSaved?.(saved);
      toast.success("Template saved");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to save template");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Template name" />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Description</span>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" rows={2} />
        </label>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Repositories</h2>
          <Button type="button" size="sm" variant="outline" onClick={addRepository}>
            <Plus className="h-4 w-4" />
            Add repository
          </Button>
        </div>
        {repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No repositories.</p>
        ) : (
          repositories.map((repository, index) => (
            <div key={index} className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
              <Input
                value={repository.githubFullName}
                onChange={(event) => updateRepository(index, { githubFullName: event.target.value })}
                placeholder="owner/repo"
              />
              <Input
                value={repository.cloneUrl}
                onChange={(event) => updateRepository(index, { cloneUrl: event.target.value })}
                placeholder="Clone URL"
              />
              <Input
                value={repository.workspacePath}
                onChange={(event) => updateRepository(index, { workspacePath: event.target.value })}
                placeholder="Workspace path"
              />
              <Input
                value={repository.defaultBranch}
                onChange={(event) => updateRepository(index, { defaultBranch: event.target.value })}
                placeholder="Default branch"
              />
              <Input
                value={repository.role}
                onChange={(event) => updateRepository(index, { role: event.target.value })}
                placeholder="Role (optional)"
              />
              <div className="flex items-center justify-end">
                <Button type="button" size="sm" variant="ghost" onClick={() => removeRepository(index)}>
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </div>
            </div>
          ))
        )}
      </section>

      <div className="space-y-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Validation commands</span>
          <span className="block text-xs text-muted-foreground">One command per line.</span>
          <Textarea
            value={validationCommands}
            onChange={(event) => setValidationCommands(event.target.value)}
            placeholder="npm test"
            rows={3}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">After-create hook</span>
          <Textarea value={afterCreateHook} onChange={(event) => setAfterCreateHook(event.target.value)} rows={3} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Prompt template</span>
          <Textarea value={promptTemplate} onChange={(event) => setPromptTemplate(event.target.value)} rows={4} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Dev environment (markdown)</span>
          <Textarea value={devEnvMarkdown} onChange={(event) => setDevEnvMarkdown(event.target.value)} rows={6} />
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => void handleExport()}>
          <Download className="h-4 w-4" />
          Export
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save template"}
        </Button>
      </div>
    </form>
  );
}
