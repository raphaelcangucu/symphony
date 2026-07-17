export type DevEnvStepSource = "convention" | "readme" | "heuristic" | "manual";

export type DevEnvStepRole = "setup" | "serve";

export type DevEnvReadyProbe = "tcp" | "http";

export interface DevEnvStep {
  id?: string;
  description: string;
  command: string;
  stopCommand?: string | null;
  workingDir: string | null;
  position?: number;
  source: DevEnvStepSource;
  optional: boolean;
  role: DevEnvStepRole;
  primary: boolean;
  portEnv: string | null;
  urlPath: string;
  readyProbe: DevEnvReadyProbe;
  readyPath: string;
  runSpec?: Record<string, unknown> | null;
}

export type DevEnvRunStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface DevEnvStepRun {
  id: string;
  stepId: string | null;
  description: string;
  command: string;
  status: DevEnvRunStatus;
  exitCode: number | null;
  output: string | null;
}

export interface DevEnvRun {
  id: string;
  status: DevEnvRunStatus;
  stepRuns: DevEnvStepRun[];
}
