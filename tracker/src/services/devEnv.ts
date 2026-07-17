import type { DevEnvRun, DevEnvStep, DevEnvStepRun } from "@/types/devEnv";
import { http, trackerPath, unwrapData } from "./http";

interface StepDto {
  id?: number | string;
  description: string;
  command: string;
  stop_command?: string | null;
  working_dir?: string | null;
  position?: number;
  source: DevEnvStep["source"];
  optional?: boolean;
  role?: DevEnvStep["role"];
  primary?: boolean;
  port_env?: string | null;
  url_path?: string | null;
  ready_probe?: DevEnvStep["readyProbe"];
  ready_path?: string | null;
  run_spec?: Record<string, unknown> | null;
}

interface StepRunDto {
  id: number | string;
  step_id?: number | string | null;
  description: string;
  command: string;
  status: DevEnvStepRun["status"];
  exit_code?: number | null;
  output?: string | null;
}

interface RunDto {
  id: number | string;
  status: DevEnvRun["status"];
  step_runs?: StepRunDto[];
}

function normalizeStep(dto: StepDto): DevEnvStep {
  return {
    id: dto.id !== undefined ? String(dto.id) : undefined,
    description: dto.description,
    command: dto.command,
    ...(dto.stop_command !== undefined ? { stopCommand: dto.stop_command } : {}),
    workingDir: dto.working_dir ?? null,
    position: dto.position,
    source: dto.source,
    optional: dto.optional ?? false,
    role: dto.role ?? "setup",
    primary: dto.primary ?? false,
    portEnv: dto.port_env ?? null,
    urlPath: dto.url_path ?? "/",
    readyProbe: dto.ready_probe ?? "tcp",
    readyPath: dto.ready_path ?? "/",
    ...(dto.run_spec !== undefined ? { runSpec: dto.run_spec } : {}),
  };
}

function denormalizeStep(step: DevEnvStep): Record<string, unknown> {
  return {
    description: step.description,
    command: step.command,
    stop_command: step.stopCommand,
    working_dir: step.workingDir,
    source: step.source,
    optional: step.optional,
    role: step.role,
    primary: step.primary,
    port_env: step.portEnv,
    url_path: step.urlPath,
    ready_probe: step.readyProbe,
    ready_path: step.readyPath,
    run_spec: step.runSpec,
  };
}

function normalizeStepRun(dto: StepRunDto): DevEnvStepRun {
  return {
    id: String(dto.id),
    stepId: dto.step_id !== undefined && dto.step_id !== null ? String(dto.step_id) : null,
    description: dto.description,
    command: dto.command,
    status: dto.status,
    exitCode: dto.exit_code ?? null,
    output: dto.output ?? null,
  };
}

function normalizeRun(dto: RunDto): DevEnvRun {
  return {
    id: String(dto.id),
    status: dto.status,
    stepRuns: (dto.step_runs ?? []).map(normalizeStepRun),
  };
}

export async function proposeDevEnvSteps(projectSlug: string): Promise<DevEnvStep[]> {
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/dev_env/propose`), {});
  return unwrapData<StepDto[]>(response).map(normalizeStep);
}

export async function listDevEnvSteps(projectSlug: string): Promise<DevEnvStep[]> {
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/dev_env/steps`));
  return unwrapData<StepDto[]>(response).map(normalizeStep);
}

export async function saveDevEnvSteps(projectSlug: string, steps: DevEnvStep[]): Promise<DevEnvStep[]> {
  const response = await http.put(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/dev_env/steps`), {
    steps: steps.map(denormalizeStep),
  });
  return unwrapData<StepDto[]>(response).map(normalizeStep);
}

export async function runDevEnv(projectSlug: string): Promise<DevEnvRun> {
  const response = await http.post(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/dev_env/run`), {});
  return normalizeRun(unwrapData<RunDto>(response));
}

export async function runDevEnvStep(projectSlug: string, stepId: string): Promise<DevEnvStepRun> {
  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/dev_env/steps/${encodeURIComponent(stepId)}/run`),
    {},
  );
  return normalizeStepRun(unwrapData<StepRunDto>(response));
}

export async function listDevEnvRuns(projectSlug: string): Promise<DevEnvRun[]> {
  const response = await http.get(trackerPath(`/projects/${encodeURIComponent(projectSlug)}/dev_env/runs`));
  return unwrapData<RunDto[]>(response).map(normalizeRun);
}
