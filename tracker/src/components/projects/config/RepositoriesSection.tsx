import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_REPOSITORY_BRANCH,
  defaultWorkspacePath,
  inferRole,
  repositoryNameFromFullName,
} from "@/lib/workspaceRepositories";
import { listGitHubOwners, listGitHubRepositories } from "@/services/projectSetup";
import type { GitHubOwner, WorkspaceRepository } from "@/types/repository";

interface RepositoriesSectionProps {
  value: WorkspaceRepository[];
  onChange: (repositories: WorkspaceRepository[]) => void;
}

export function RepositoriesSection({ value, onChange }: RepositoriesSectionProps) {
  const { t } = useTranslation();
  const linkedFullNames = new Set(value.map((repository) => repository.fullName));

  function updateRepository(fullName: string, changes: Partial<WorkspaceRepository>) {
    onChange(value.map((repository) => (repository.fullName === fullName ? { ...repository, ...changes } : repository)));
  }

  function removeRepository(fullName: string) {
    onChange(value.filter((repository) => repository.fullName !== fullName));
  }

  function addRepository(repository: WorkspaceRepository) {
    if (linkedFullNames.has(repository.fullName)) return;
    onChange([...value, withRepositoryDefaults(repository)]);
  }

  return (
    <div className="space-y-4">
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
          {t("project.config.repoEditor.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {value.map((repository) => (
            <li key={repository.fullName} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-sm font-medium">{repository.fullName}</p>
                  {repository.private ? (
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      {t("project.config.repoEditor.private")}
                    </Badge>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRepository(repository.fullName)}
                  aria-label={t("project.config.repoEditor.removeAria", { repo: repository.fullName })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-muted-foreground">{t("project.config.repoEditor.workspacePath")}</span>
                  <Input
                    value={repository.workspacePath}
                    onChange={(event) => updateRepository(repository.fullName, { workspacePath: event.target.value })}
                    aria-label={t("project.config.repoEditor.workspacePathAria", { repo: repository.fullName })}
                    className="font-mono text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-muted-foreground">{t("project.config.repoEditor.role")}</span>
                  <Input
                    value={repository.role}
                    onChange={(event) => updateRepository(repository.fullName, { role: event.target.value })}
                    aria-label={t("project.config.repoEditor.roleAria", { repo: repository.fullName })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-muted-foreground">{t("project.config.repoEditor.branch")}</span>
                  <Input
                    value={repository.selectedBranch ?? ""}
                    onChange={(event) => updateRepository(repository.fullName, { selectedBranch: event.target.value })}
                    aria-label={t("project.config.repoEditor.branchAria", { repo: repository.fullName })}
                    placeholder={repository.defaultBranch ?? DEFAULT_REPOSITORY_BRANCH}
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddRepository linkedFullNames={linkedFullNames} onAdd={addRepository} />
    </div>
  );
}

interface AddRepositoryProps {
  linkedFullNames: Set<string>;
  onAdd: (repository: WorkspaceRepository) => void;
}

function AddRepository({ linkedFullNames, onAdd }: AddRepositoryProps) {
  const { t } = useTranslation();
  const [owners, setOwners] = useState<GitHubOwner[]>([]);
  const [owner, setOwner] = useState("");
  const [repositories, setRepositories] = useState<WorkspaceRepository[]>([]);
  const [loadingOwners, setLoadingOwners] = useState(false);
  const [loadingRepositories, setLoadingRepositories] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingOwners(true);
    listGitHubOwners()
      .then((items) => active && setOwners(items))
      .catch(
        (cause) =>
          active &&
          toast.error(cause instanceof Error ? cause.message : t("project.config.repoEditor.toasts.loadOwnersFailed")),
      )
      .finally(() => active && setLoadingOwners(false));
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    const trimmedOwner = owner.trim();
    if (!trimmedOwner) {
      setRepositories([]);
      return;
    }

    let active = true;
    setLoadingRepositories(true);
    listGitHubRepositories(trimmedOwner)
      .then((items) => active && setRepositories(items))
      .catch(
        (cause) =>
          active &&
          toast.error(cause instanceof Error ? cause.message : t("project.config.repoEditor.toasts.loadReposFailed")),
      )
      .finally(() => active && setLoadingRepositories(false));
    return () => {
      active = false;
    };
  }, [owner, t]);

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">{t("project.config.repoEditor.addRepository")}</p>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-muted-foreground">{t("project.config.repoEditor.githubOwner")}</span>
        <select
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
          aria-label={t("project.config.repoEditor.githubOwnerAria")}
          disabled={loadingOwners}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">
            {loadingOwners ? t("project.config.repoEditor.loadingOwners") : t("project.config.repoEditor.selectOwner")}
          </option>
          {owners.map((item) => (
            <option key={item.login} value={item.login}>
              {item.name ? `${item.name} (${item.login})` : item.login}
            </option>
          ))}
        </select>
      </label>

      {owner.trim() ? (
        loadingRepositories ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {t("project.config.repoEditor.loadingRepositories")}
          </p>
        ) : repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("project.config.repoEditor.noRepositories")}</p>
        ) : (
          <div className="grid max-h-56 gap-2 overflow-y-auto">
            {repositories.map((repository) => {
              const alreadyLinked = linkedFullNames.has(repository.fullName);
              return (
                <button
                  key={repository.fullName}
                  type="button"
                  disabled={alreadyLinked}
                  onClick={() => onAdd(repository)}
                  aria-label={t("project.config.repoEditor.addRepoAria", { repo: repository.fullName })}
                  className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-left transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{repository.fullName}</span>
                    {repository.description ? (
                      <span className="block truncate text-xs text-muted-foreground">{repository.description}</span>
                    ) : null}
                  </span>
                  {alreadyLinked ? (
                    <Badge variant="secondary" className="shrink-0 text-[10px] uppercase">
                      {t("project.config.repoEditor.linked")}
                    </Badge>
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}

function withRepositoryDefaults(repository: WorkspaceRepository): WorkspaceRepository {
  const name = repository.name ?? repositoryNameFromFullName(repository.fullName);
  return {
    ...repository,
    workspacePath: repository.workspacePath || defaultWorkspacePath(name),
    role: repository.role || inferRole(name),
    selectedBranch: repository.selectedBranch ?? repository.defaultBranch ?? DEFAULT_REPOSITORY_BRANCH,
  };
}
