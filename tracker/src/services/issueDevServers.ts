import type { IssueDevServersResponse } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";

type IssueDevServerAction = "start" | "stop" | "restart";

const DEV_SERVERS_PATH_SEGMENT = "dev_servers";

export async function fetchIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
): Promise<IssueDevServersResponse> {
  const response = await http.get(issueDevServersPath(projectSlug, issueIdentifier));

  return unwrapData<IssueDevServersResponse>(response);
}

export async function startIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerAction(projectSlug, issueIdentifier, "start");
}

export async function stopIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerAction(projectSlug, issueIdentifier, "stop");
}

export async function restartIssueDevServers(
  projectSlug: string,
  issueIdentifier: string,
): Promise<IssueDevServersResponse> {
  return postIssueDevServerAction(projectSlug, issueIdentifier, "restart");
}

async function postIssueDevServerAction(
  projectSlug: string,
  issueIdentifier: string,
  action: IssueDevServerAction,
): Promise<IssueDevServersResponse> {
  const response = await http.post(`${issueDevServersPath(projectSlug, issueIdentifier)}/${action}`);

  return unwrapData<IssueDevServersResponse>(response);
}

function issueDevServersPath(projectSlug: string, issueIdentifier: string): string {
  requireNonBlank(projectSlug, "projectSlug");
  requireNonBlank(issueIdentifier, "issueIdentifier");

  return trackerPath(
    `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(issueIdentifier)}/${DEV_SERVERS_PATH_SEGMENT}`,
  );
}

function requireNonBlank(value: string, fieldName: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
}
