import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { BranchAutocomplete } from "@/components/sessions/BranchAutocomplete";
import { useProjectBranches } from "@/hooks/useProjectBranches";
import {
  branchNamesForRepo,
  fallbackBranchSuggestions,
  workspaceCloneRepoOptions,
  type WorkspaceCloneRepoOption,
} from "@/lib/workspaceCloneRepos";
import { getProject } from "@/services/projects";

const GLOBAL_FALLBACK_KEY = "__default__";

interface WorkspaceCloneBranchesFieldsProps {
  projectSlug: string;
  /** When false, skip remote fetches (e.g. dialog closed). */
  active?: boolean;
  /** Prefer these repos; when empty, load from project configuration. */
  repos?: WorkspaceCloneRepoOption[];
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
  /**
   * When no configured/inventory repos exist, still show one optional branch field
   * (maps to `__default__` / `clone_branch` for hook-based workspaces).
   */
  allowGlobalFallback?: boolean;
  globalDefault?: string;
}

export function WorkspaceCloneBranchesFields({
  projectSlug,
  active = true,
  repos: reposProp,
  value,
  onChange,
  disabled = false,
  allowGlobalFallback = true,
  globalDefault = "pre-release",
}: WorkspaceCloneBranchesFieldsProps) {
  const { t } = useTranslation();
  const [loadedRepos, setLoadedRepos] = useState<WorkspaceCloneRepoOption[]>([]);

  useEffect(() => {
    if (!active || (reposProp && reposProp.length > 0)) {
      if (!active) setLoadedRepos([]);
      return;
    }

    let cancelled = false;
    void getProject(projectSlug)
      .then((project) => {
        if (cancelled) return;
        setLoadedRepos(workspaceCloneRepoOptions([], project.repositories));
      })
      .catch(() => {
        if (!cancelled) setLoadedRepos([]);
      });

    return () => {
      cancelled = true;
    };
  }, [active, projectSlug, reposProp]);

  const repos = useMemo(() => {
    if (reposProp && reposProp.length > 0) return reposProp;
    return loadedRepos;
  }, [loadedRepos, reposProp]);

  const rows = useMemo(() => {
    if (repos.length > 0) return repos;
    if (!allowGlobalFallback) return [];
    return [
      {
        key: GLOBAL_FALLBACK_KEY,
        label: t("workspacesPage.newWorkspace.globalBranchLabel"),
        defaultBranch: globalDefault,
        githubFullName: null,
      } satisfies WorkspaceCloneRepoOption,
    ];
  }, [allowGlobalFallback, globalDefault, repos, t]);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">{t("workspacesPage.newWorkspace.branchesLabel")}</p>
      <div className="space-y-1.5">
        {rows.map((repo) => (
          <CloneBranchRow
            key={repo.key}
            projectSlug={projectSlug}
            active={active}
            repo={repo}
            showRepoLabel={repos.length > 0 || !allowGlobalFallback}
            value={value[repo.key] ?? ""}
            onChange={(next) => onChange({ ...value, [repo.key]: next })}
            disabled={disabled}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("workspacesPage.newWorkspace.branchesHint")}</p>
    </div>
  );
}

function CloneBranchRow({
  projectSlug,
  active,
  repo,
  showRepoLabel,
  value,
  onChange,
  disabled,
}: {
  projectSlug: string;
  active: boolean;
  repo: WorkspaceCloneRepoOption;
  showRepoLabel: boolean;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const searchEnabled = repo.key !== GLOBAL_FALLBACK_KEY;
  const { branches, loading } = useProjectBranches(projectSlug, active && searchEnabled, value);

  const suggestions =
    repo.key === GLOBAL_FALLBACK_KEY
      ? fallbackBranchSuggestions(repo.defaultBranch)
      : branchNamesForRepo(branches, repo);

  return (
    <div className="flex items-center gap-2">
      {showRepoLabel ? (
        <span className="w-32 shrink-0 truncate text-xs text-muted-foreground" title={repo.label}>
          {repo.label}
        </span>
      ) : null}
      <BranchAutocomplete
        value={value}
        onChange={onChange}
        suggestions={suggestions}
        placeholder={repo.defaultBranch ?? t("workspacesPage.newWorkspace.branchPlaceholder")}
        disabled={disabled}
        loading={loading && searchEnabled}
        aria-label={t("workspacesPage.newWorkspace.branchAria", { repo: repo.label })}
      />
    </div>
  );
}

export { GLOBAL_FALLBACK_KEY };
