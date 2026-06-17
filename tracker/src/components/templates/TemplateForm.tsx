import { Download, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
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
  uid: string;
  githubFullName: string;
  cloneUrl: string;
  defaultBranch: string;
  workspacePath: string;
  role: string;
}

function generateUid(): string {
  return crypto.randomUUID();
}

function toRepositoryFields(repository: WorkspaceTemplate["repositories"][number]): RepositoryFields {
  return {
    uid: repository.id ?? generateUid(),
    githubFullName: repository.githubFullName,
    cloneUrl: repository.cloneUrl,
    defaultBranch: repository.defaultBranch ?? "",
    workspacePath: repository.workspacePath,
    role: repository.role ?? "",
  };
}

function emptyRepository(): RepositoryFields {
  return { uid: generateUid(), githubFullName: "", cloneUrl: "", defaultBranch: "", workspacePath: "", role: "" };
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
  const { t } = useTranslation();
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
      toast.error(cause instanceof Error ? cause.message : t("project.templates.toasts.exportFailed"));
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
      toast.success(t("project.templates.toasts.saved"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.templates.toasts.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t("project.templates.form.name")}</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("project.templates.form.namePlaceholder")}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t("project.templates.form.description")}</span>
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("project.templates.form.descriptionPlaceholder")}
            rows={2}
          />
        </label>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("project.templates.form.repositories")}</h2>
          <Button type="button" size="sm" variant="outline" onClick={addRepository}>
            <Plus className="h-4 w-4" />
            {t("project.templates.form.addRepository")}
          </Button>
        </div>
        {repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("project.templates.form.noRepositories")}</p>
        ) : (
          repositories.map((repository, index) => (
            <div key={repository.uid} className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
              <Input
                aria-label={t("project.templates.form.githubFullName")}
                value={repository.githubFullName}
                onChange={(event) => updateRepository(index, { githubFullName: event.target.value })}
                placeholder={t("project.templates.form.githubFullNamePlaceholder")}
              />
              <Input
                aria-label={t("project.templates.form.cloneUrl")}
                value={repository.cloneUrl}
                onChange={(event) => updateRepository(index, { cloneUrl: event.target.value })}
                placeholder={t("project.templates.form.cloneUrlPlaceholder")}
              />
              <Input
                aria-label={t("project.templates.form.workspacePath")}
                value={repository.workspacePath}
                onChange={(event) => updateRepository(index, { workspacePath: event.target.value })}
                placeholder={t("project.templates.form.workspacePath")}
              />
              <Input
                aria-label={t("project.templates.form.defaultBranch")}
                value={repository.defaultBranch}
                onChange={(event) => updateRepository(index, { defaultBranch: event.target.value })}
                placeholder={t("project.templates.form.defaultBranch")}
              />
              <Input
                aria-label={t("project.templates.form.role")}
                value={repository.role}
                onChange={(event) => updateRepository(index, { role: event.target.value })}
                placeholder={t("project.templates.form.rolePlaceholder")}
              />
              <div className="flex items-center justify-end">
                <Button type="button" size="sm" variant="ghost" onClick={() => removeRepository(index)}>
                  <Trash2 className="h-4 w-4" />
                  {t("project.templates.form.remove")}
                </Button>
              </div>
            </div>
          ))
        )}
      </section>

      <div className="space-y-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t("project.templates.form.validationCommands")}</span>
          <span className="block text-xs text-muted-foreground">{t("project.templates.form.validationCommandsHint")}</span>
          <Textarea
            value={validationCommands}
            onChange={(event) => setValidationCommands(event.target.value)}
            placeholder={t("project.templates.form.validationCommandsPlaceholder")}
            rows={3}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t("project.templates.form.afterCreateHook")}</span>
          <Textarea value={afterCreateHook} onChange={(event) => setAfterCreateHook(event.target.value)} rows={3} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t("project.templates.form.promptTemplate")}</span>
          <Textarea value={promptTemplate} onChange={(event) => setPromptTemplate(event.target.value)} rows={4} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t("project.templates.form.devEnvMarkdown")}</span>
          <Textarea value={devEnvMarkdown} onChange={(event) => setDevEnvMarkdown(event.target.value)} rows={6} />
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => void handleExport()}>
          <Download className="h-4 w-4" />
          {t("project.templates.form.export")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t("project.templates.form.saving") : t("project.templates.form.save")}
        </Button>
      </div>
    </form>
  );
}
