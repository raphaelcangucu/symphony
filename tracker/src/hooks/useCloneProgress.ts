import { useEffect, useReducer } from "react";

export interface CloneEvent {
  event: "clone_started" | "clone_succeeded" | "clone_failed" | "clone_skipped";
  repository_id: string;
  github_full_name?: string;
  commit_sha?: string;
  error?: string;
}

export interface CloneJobView {
  repositoryId: string;
  githubFullName?: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  commitSha?: string;
  error?: string;
}

export interface CloneProgressState {
  jobs: Record<string, CloneJobView>;
  allSucceeded: boolean;
  anyFailed: boolean;
  inProgressCount: number;
}

export const initialCloneState: CloneProgressState = {
  jobs: {},
  allSucceeded: false,
  anyFailed: false,
  inProgressCount: 0,
};

export function cloneProgressReducer(state: CloneProgressState, event: CloneEvent): CloneProgressState {
  const status = statusFor(event.event);
  const job: CloneJobView = {
    repositoryId: event.repository_id,
    githubFullName: event.github_full_name ?? state.jobs[event.repository_id]?.githubFullName,
    status,
    commitSha: event.commit_sha,
    error: event.error,
  };

  const jobs = { ...state.jobs, [event.repository_id]: job };
  const values = Object.values(jobs);

  return {
    jobs,
    allSucceeded: values.length > 0 && values.every((j) => j.status === "succeeded" || j.status === "skipped"),
    anyFailed: values.some((j) => j.status === "failed"),
    inProgressCount: values.filter((j) => j.status === "running").length,
  };
}

function statusFor(event: CloneEvent["event"]): CloneJobView["status"] {
  switch (event) {
    case "clone_started":
      return "running";
    case "clone_succeeded":
      return "succeeded";
    case "clone_skipped":
      return "skipped";
    case "clone_failed":
      return "failed";
  }
}

export function useCloneProgress(
  subscribe: (handler: (event: CloneEvent) => void) => () => void,
): CloneProgressState {
  const [state, dispatch] = useReducer(cloneProgressReducer, initialCloneState);

  useEffect(() => subscribe((event) => dispatch(event)), [subscribe]);

  return state;
}
