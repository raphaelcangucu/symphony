export type DevEnvStepSource = "convention" | "readme" | "heuristic" | "manual";

export interface DevEnvStep {
  id?: string;
  description: string;
  command: string;
  workingDir: string | null;
  position?: number;
  source: DevEnvStepSource;
  optional: boolean;
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
