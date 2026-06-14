import type { DevEnvStep } from "@/types/devEnv";
import type { WorkspaceRepository } from "@/types/repository";

export const GENERAL_GROUP_KEY = "__general__";

export interface DevEnvStepGroup {
  key: string;
  label: string;
  repoRole: string | null;
  workingDir: string | null;
  items: { step: DevEnvStep; index: number }[];
}

export function emptyDevEnvStep(workingDir: string | null): DevEnvStep {
  return {
    description: "",
    command: "",
    workingDir,
    source: "manual",
    optional: false,
    role: "setup",
    primary: false,
    portEnv: null,
    urlPath: "/",
    readyProbe: "tcp",
    readyPath: "/",
  };
}

function normalizeWorkingDir(workingDir: string | null | undefined): string | null {
  const trimmed = workingDir?.trim();
  return trimmed ? trimmed : null;
}

/** Build one group per linked repository (in order) plus a trailing "General" group for the rest. */
export function buildDevEnvGroups(steps: DevEnvStep[], repositories: WorkspaceRepository[]): DevEnvStepGroup[] {
  const repoGroups: DevEnvStepGroup[] = repositories.map((repo) => ({
    key: repo.workspacePath,
    label: repo.fullName || repo.workspacePath,
    repoRole: repo.role ?? null,
    workingDir: repo.workspacePath,
    items: [],
  }));
  const byKey = new Map(repoGroups.map((group) => [group.key, group]));
  const general: DevEnvStepGroup = {
    key: GENERAL_GROUP_KEY,
    label: "General",
    repoRole: null,
    workingDir: null,
    items: [],
  };

  steps.forEach((step, index) => {
    const workingDir = normalizeWorkingDir(step.workingDir);
    const group = (workingDir && byKey.get(workingDir)) || general;
    group.items.push({ step, index });
  });

  return [...repoGroups, general];
}

/** Flatten steps in repository-group order so the persisted sequence matches the per-repo layout. */
export function orderStepsByRepository(steps: DevEnvStep[], repositories: WorkspaceRepository[]): DevEnvStep[] {
  return buildDevEnvGroups(steps, repositories).flatMap((group) => group.items.map((item) => item.step));
}
